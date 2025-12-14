import os
import uuid
import shutil
import asyncio
import logging
from typing import Optional, Dict
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import yt_dlp

# --- Configuration ---
DOWNLOAD_DIR = "downloads"
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# Logging setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="YT Downloader")

# Mount the static directory
app.mount("/static", StaticFiles(directory="static"), name="static")

# Set up templates
templates = Jinja2Templates(directory="templates")

# Simple in-memory job store (Use Redis for true production scaling)
# Structure: job_id -> {status: str, file_path: str, filename: str, error: str}
jobs: Dict[str, dict] = {}

# --- Pydantic Models ---
class VideoRequest(BaseModel):
    url: str

class DownloadRequest(BaseModel):
    url: str
    format_id: str
    is_audio_only: bool = False

# --- Helpers ---
def cleanup_file(path: str):
    """Background task to remove file after download"""
    try:
        if os.path.exists(path):
            os.remove(path)
            logger.info(f"Cleaned up file: {path}")
    except Exception as e:
        logger.error(f"Error cleaning up {path}: {e}")

def process_download(job_id: str, url: str, format_id: str, is_audio_only: bool):
    """Heavy lifting function running in background"""
    job_dir = os.path.join(DOWNLOAD_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)
    
    jobs[job_id]["status"] = "processing"
    
    # Configure yt-dlp
    # We use a custom output template to ensure we know where the file lands
    out_tmpl = os.path.join(job_dir, '%(title)s.%(ext)s')
    
    ydl_opts = {
        'outtmpl': out_tmpl,
        'quiet': True,
        'no_warnings': True,
    }

    if is_audio_only:
        # Audio conversion settings
        ydl_opts.update({
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
        })
    else:
        # Video settings: Download specific format + best audio and merge
        ydl_opts.update({
            'format': f"{format_id}+bestaudio/best" if format_id != 'best' else "bestvideo+bestaudio/best",
            'merge_output_format': 'mp4',  # Ensure final container is mp4
        })

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            
            # Find the generated file
            if 'requested_downloads' in info:
                final_filename = info['requested_downloads'][0]['filepath']
            else:
                # Fallback for simple downloads
                # We need to scan the dir because the filename might contain sanitized chars
                files = os.listdir(job_dir)
                if not files:
                    raise Exception("File not found after download")
                final_filename = os.path.join(job_dir, files[0])

            jobs[job_id]["file_path"] = final_filename
            jobs[job_id]["filename"] = os.path.basename(final_filename)
            jobs[job_id]["status"] = "completed"
            
    except Exception as e:
        logger.error(f"Download failed for {job_id}: {str(e)}")
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(e)
        # Cleanup empty dir
        shutil.rmtree(job_dir, ignore_errors=True)

# --- Routes ---

@app.get("/", response_class=HTMLResponse)
async def read_root():
    # Serving the HTML file directly for simplicity in this structure
    with open("index.html", "r") as f:
        return f.read()

@app.post("/api/info")
async def get_video_info(request: VideoRequest):
    """Fetch metadata and available formats"""
    try:
        ydl_opts = {'quiet': True, 'no_warnings': True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(request.url, download=False)
        
        formats = []
        seen_res = set()
        
        # Filter and organize formats for the UI
        for f in info.get('formats', []):
            # We want video files that have a resolution, exclude audio-only for the video list
            if f.get('vcodec') != 'none' and f.get('height'):
                res = f"{f['height']}p"
                ext = f['ext']
                
                # Deduplicate roughly by resolution
                if res not in seen_res and ext in ['mp4', 'webm']:
                    formats.append({
                        "format_id": f['format_id'],
                        "resolution": res,
                        "ext": ext,
                        "filesize": f.get('filesize_approx', 0)
                    })
                    seen_res.add(res)
        
        # Sort by height (resolution) descending
        formats.sort(key=lambda x: int(x['resolution'][:-1]), reverse=True)

        return {
            "title": info.get('title'),
            "thumbnail": info.get('thumbnail'),
            "duration": info.get('duration'),
            "formats": formats
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/queue")
async def queue_download(request: DownloadRequest, background_tasks: BackgroundTasks):
    """Create a download job"""
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "queued",
        "url": request.url
    }
    
    background_tasks.add_task(
        process_download, 
        job_id, 
        request.url, 
        request.format_id, 
        request.is_audio_only
    )
    
    return {"job_id": job_id}

@app.get("/api/status/{job_id}")
async def get_status(job_id: str):
    """Poll this endpoint to check if download is ready"""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return {
        "status": job["status"], 
        "error": job.get("error")
    }

@app.get("/api/download/{job_id}")
async def download_file(job_id: str, background_tasks: BackgroundTasks):
    """Serve the file and schedule cleanup"""
    job = jobs.get(job_id)
    if not job or job["status"] != "completed":
        raise HTTPException(status_code=400, detail="File not ready or job failed")
    
    file_path = job["file_path"]
    filename = job["filename"]
    
    # Schedule cleanup of the specific job directory after response is sent
    # Note: simple os.remove won't remove the directory, so we wrap it
    def cleanup_job_dir():
        parent_dir = os.path.dirname(file_path)
        shutil.rmtree(parent_dir, ignore_errors=True)
        # Also remove from memory
        jobs.pop(job_id, None)

    background_tasks.add_task(cleanup_job_dir)
    
    return FileResponse(
        path=file_path, 
        filename=filename, 
        media_type='application/octet-stream'
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
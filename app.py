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

# Simple in-memory job store
jobs: Dict[str, dict] = {}

# --- Pydantic Models ---
class VideoRequest(BaseModel):
    url: str

class DownloadRequest(BaseModel):
    url: str
    format_id: str
    is_audio_only: bool = False

# --- Helpers ---
def get_cookie_path():
    """
    Locate cookies. If they are in a read-only directory (Render Secrets),
    copy them to a writable location so yt-dlp doesn't crash when trying to lock/write.
    """
    secret_path = "/etc/secrets/cookies.txt"
    writable_path = "cookies.txt" # This path is writable in the container

    # 1. Check if we are on Render and have secrets
    if os.path.exists(secret_path):
        try:
            # Copy the read-only file to a writable location
            # This overwrites any existing local cookies.txt to ensure we use the latest secret
            shutil.copyfile(secret_path, writable_path)
            logger.info(f"Cookies copied from {secret_path} to {writable_path}")
            return writable_path
        except Exception as e:
            logger.error(f"Error copying cookies from secrets: {e}")
            # Fallback to secret path (might crash, but worth a try)
            return secret_path

    # 2. Check for local dev file
    if os.path.exists(writable_path):
        logger.info(f"Using local cookies from {writable_path}")
        return writable_path

    logger.warning("No cookies.txt found. YouTube might block requests.")
    return None

def cleanup_file(path: str):
    """Background task to remove file after download"""
    try:
        if os.path.exists(path):
            os.remove(path)
            logger.info(f"Cleaned up file: {path}")
    except Exception as e:
        logger.error(f"Error cleaning up {path}: {e}")

def get_ydl_opts(basic_mode=False):
    """
    Centralized yt-dlp options generator to ensure consistency.
    Includes User-Agent spoofing to avoid bot detection.
    """
    opts = {
        'quiet': True,
        'no_warnings': True,
        # Spoof User-Agent to look like a real browser
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        # Force IPv4 as IPv6 often triggers bot detection on cloud servers
        'source_address': '0.0.0.0',
    }
    
    # Inject cookies if found
    cookie_path = get_cookie_path()
    if cookie_path:
        opts['cookiefile'] = cookie_path
        
    return opts

def process_download(job_id: str, url: str, format_id: str, is_audio_only: bool):
    """Heavy lifting function running in background"""
    job_dir = os.path.join(DOWNLOAD_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)
    
    jobs[job_id]["status"] = "processing"
    jobs[job_id]["progress"] = 0
    
    # Output template
    out_tmpl = os.path.join(job_dir, '%(title)s.%(ext)s')
    
    # Progress hook
    def progress_hook(d):
        if d['status'] == 'downloading':
            try:
                total = d.get('total_bytes') or d.get('total_bytes_estimate')
                downloaded = d.get('downloaded_bytes', 0)
                if total:
                    p = (downloaded / total) * 100
                    jobs[job_id]["progress"] = p
            except Exception:
                pass
        elif d['status'] == 'finished':
            jobs[job_id]["progress"] = 99

    # Get base options
    ydl_opts = get_ydl_opts()
    
    # Add download-specific options
    ydl_opts.update({
        'outtmpl': out_tmpl,
        'progress_hooks': [progress_hook],
    })

    if is_audio_only:
        ydl_opts.update({
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
        })
    else:
        ydl_opts.update({
            'format': f"{format_id}+bestaudio/best" if format_id != 'best' else "bestvideo+bestaudio/best",
            'merge_output_format': 'mp4',
        })

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            
            if 'requested_downloads' in info:
                final_filename = info['requested_downloads'][0]['filepath']
            else:
                files = os.listdir(job_dir)
                if not files:
                    raise Exception("File not found after download")
                final_filename = os.path.join(job_dir, files[0])

            jobs[job_id]["file_path"] = final_filename
            jobs[job_id]["filename"] = os.path.basename(final_filename)
            jobs[job_id]["status"] = "completed"
            jobs[job_id]["progress"] = 100
            
    except Exception as e:
        logger.error(f"Download failed for {job_id}: {str(e)}")
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(e)
        shutil.rmtree(job_dir, ignore_errors=True)

# --- Routes ---

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/api/info")
async def get_video_info(request: VideoRequest):
    """Fetch metadata and available formats"""
    try:
        # Get base options with User-Agent and Cookies
        ydl_opts = get_ydl_opts()
            
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(request.url, download=False)
        
        formats = []
        seen_res = set()
        
        for f in info.get('formats', []):
            if f.get('vcodec') != 'none' and f.get('height'):
                res = f"{f['height']}p"
                ext = f['ext']
                
                if res not in seen_res and ext in ['mp4', 'webm']:
                    fs = f.get('filesize')
                    if fs is None:
                        fs = f.get('filesize_approx')
                    
                    formats.append({
                        "format_id": f['format_id'],
                        "resolution": res,
                        "ext": ext,
                        "filesize": fs if fs else 0
                    })
                    seen_res.add(res)
        
        formats.sort(key=lambda x: int(x['resolution'][:-1]), reverse=True)

        return {
            "title": info.get('title'),
            "thumbnail": info.get('thumbnail'),
            "duration": info.get('duration'),
            "formats": formats,
            "uploader": info.get('uploader')
        }
    except Exception as e:
        # Detailed logging for debugging
        logger.error(f"Info fetch failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/queue")
async def queue_download(request: DownloadRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "queued",
        "url": request.url,
        "progress": 0
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
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return {
        "status": job["status"], 
        "progress": job.get("progress", 0),
        "error": job.get("error")
    }

@app.get("/api/download/{job_id}")
async def download_file(job_id: str, background_tasks: BackgroundTasks):
    job = jobs.get(job_id)
    if not job or job["status"] != "completed":
        raise HTTPException(status_code=400, detail="File not ready or job failed")
    
    file_path = job["file_path"]
    filename = job["filename"]
    
    def cleanup_job_dir():
        parent_dir = os.path.dirname(file_path)
        shutil.rmtree(parent_dir, ignore_errors=True)
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

import yt_dlp
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title="YouTube Downloader (Client-Side Version)")

# Serve your static directory and templates (same as before)
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


# ■■■ Pydantic Models ■■■
class VideoRequest(BaseModel):
    url: str


# ■■■ Root Route (unchanged) ■■■
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


# ■■■ MAIN API — Return direct YouTube download links ■■■
@app.post("/api/info")
async def get_video_info(request: VideoRequest):
    """Return metadata + video formats + audio formats with direct URLs."""
    try:
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(request.url, download=False)

        video_formats = []
        audio_formats = []

        for f in info.get("formats", []):
            # VIDEO FORMAT
            if f.get("vcodec") != "none" and f.get("url") and f.get("height"):
                video_formats.append({
                    "format_id": f.get("format_id"),
                    "resolution": f"{f.get('height')}p",
                    "ext": f.get("ext"),
                    "filesize": f.get("filesize") or f.get("filesize_approx"),
                    "direct_url": f.get("url"),
                })

            # AUDIO FORMAT
            if f.get("vcodec") == "none" and f.get("acodec") != "none" and f.get("url"):
                audio_formats.append({
                    "format_id": f.get("format_id"),
                    "abr": f.get("abr"),
                    "ext": f.get("ext"),
                    "filesize": f.get("filesize") or f.get("filesize_approx"),
                    "direct_url": f.get("url"),
                })

        # Sort highest → lowest
        video_formats = sorted(video_formats, key=lambda x: int(x["resolution"][:-1]), reverse=True)
        audio_formats = sorted(audio_formats, key=lambda x: x.get("abr") or 0, reverse=True)

        # IMPORTANT: match your existing frontend API format
        return {
            "title": info.get("title"),
            "thumbnail": info.get("thumbnail"),
            "duration": info.get("duration"),
            "uploader": info.get("uploader"),
            "formats": video_formats,     # Your frontend uses "formats"
            "audio_formats": audio_formats
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ■■■ Run Locally ■■■
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)

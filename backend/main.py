"""
ScanPass — Minimal FastAPI Backend (MVP)
Image upload and static file serving.
No ML. No PyTorch. No heavy dependencies.
Designed to run reliably on Render free tier.
"""

import os
import uuid
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("scanpass")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
UPLOAD_DIR = Path("uploads")
MAX_IMAGE_SIZE_MB = 5
MAX_IMAGE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024  # 5 MB

# Allowed MIME types
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}

# Extension map
MIME_TO_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

# ---------------------------------------------------------------------------
# Startup / Shutdown
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"✅ Upload directory: {UPLOAD_DIR.resolve()}")
    logger.info("🚀 ScanPass API ready.")
    yield
    logger.info("🛑 ScanPass API shutting down.")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="ScanPass API",
    description="Minimal visual registration backend — image upload only.",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://scanpass-mvp.netlify.app",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create uploads folder at import time so StaticFiles doesn't crash on startup
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Serve uploaded images as static files at /uploads/<filename>
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# ---------------------------------------------------------------------------
# Helper — derive the public base URL
# ---------------------------------------------------------------------------
def get_base_url() -> str:
    """
    Return the public base URL of this server.
    On Render, the RENDER_EXTERNAL_URL env var is set automatically.
    Falls back to localhost for local dev.
    """
    return os.environ.get("RENDER_EXTERNAL_URL", "http://127.0.0.1:8000").rstrip("/")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    """Health check — confirms the server is running."""
    return {"status": "ok", "service": "ScanPass API v2"}


@app.post("/api/upload/image")
async def upload_image(file: UploadFile = File(...)):
    """
    Accept an image upload, save it to /uploads, return a public URL.

    Limits:
    - Max size: 5 MB
    - Allowed types: JPEG, PNG, WebP, GIF
    """
    logger.info(f"📥 Upload received: {file.filename!r} ({file.content_type})")

    # --- Validate content type ---
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        logger.warning(f"❌ Rejected content type: {file.content_type}")
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{file.content_type}'. Allowed: JPEG, PNG, WebP, GIF."
        )

    # --- Read and size-check ---
    try:
        data = await file.read(MAX_IMAGE_BYTES + 1)
    except Exception as e:
        logger.error(f"❌ Failed to read upload: {e}")
        raise HTTPException(status_code=400, detail="Failed to read uploaded file.")

    if len(data) > MAX_IMAGE_BYTES:
        logger.warning(f"❌ Upload too large: {len(data)} bytes")
        raise HTTPException(
            status_code=413,
            detail=f"Image exceeds maximum allowed size of {MAX_IMAGE_SIZE_MB} MB."
        )

    # --- Generate unique filename ---
    ext = MIME_TO_EXT.get(file.content_type, ".jpg")
    filename = f"{uuid.uuid4().hex}{ext}"
    save_path = UPLOAD_DIR / filename

    # --- Write to disk ---
    try:
        save_path.write_bytes(data)
        logger.info(f"✅ Saved: {save_path} ({len(data)} bytes)")
    except Exception as e:
        logger.error(f"❌ Failed to save file: {e}")
        raise HTTPException(status_code=500, detail="Failed to save image on server.")

    # --- Build public URL ---
    image_url = f"{get_base_url()}/uploads/{filename}"
    logger.info(f"🔗 Public URL: {image_url}")

    return JSONResponse(content={
        "success": True,
        "image_url": image_url,
        "filename": filename,
        "size_bytes": len(data),
    })


@app.post("/api/register/visual")
async def register_visual(
    file: UploadFile = File(...),
    username: str = Form(...),
):
    """
    Visual registration endpoint — accepts a photo and associates it with a username.
    Stores the image; no ML processing.
    """
    logger.info(f"📝 Visual registration for user: {username!r}")

    if len(username.strip()) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters.")

    # Validate content type
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{file.content_type}'."
        )

    # Read with size limit
    try:
        data = await file.read(MAX_IMAGE_BYTES + 1)
    except Exception as e:
        logger.error(f"❌ Failed to read upload for {username!r}: {e}")
        raise HTTPException(status_code=400, detail="Failed to read uploaded file.")

    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image exceeds {MAX_IMAGE_SIZE_MB} MB limit."
        )

    # Save with username prefix for traceability
    ext = MIME_TO_EXT.get(file.content_type, ".jpg")
    safe_username = "".join(c for c in username.strip() if c.isalnum() or c in "-_")
    filename = f"{safe_username}_{uuid.uuid4().hex}{ext}"
    save_path = UPLOAD_DIR / filename

    try:
        save_path.write_bytes(data)
        logger.info(f"✅ Registered image for {username!r}: {save_path}")
    except Exception as e:
        logger.error(f"❌ Failed to save for {username!r}: {e}")
        raise HTTPException(status_code=500, detail="Failed to save image on server.")

    image_url = f"{get_base_url()}/uploads/{filename}"

    return JSONResponse(content={
        "success": True,
        "message": f"Visual registration successful for '{username}'.",
        "image_url": image_url,
        "filename": filename,
    })


# ---------------------------------------------------------------------------
# Entry point (local dev)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)

"""
Minimal FastAPI server for TryOn AI demo.
Exposes a /tryon endpoint that accepts webcam + garment images and returns a generated try-on image.

Run with:
    uvicorn server:app --reload --port 8000
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from nano_banana import NanoBananaProcessor

base_dir = Path(__file__).resolve().parent
# Load root .env first, then local my-agent/.env can override specific values
load_dotenv(dotenv_path=base_dir.parent / ".env", override=False)
load_dotenv(dotenv_path=base_dir / ".env", override=True)

if os.getenv("serper_API") and not os.getenv("GOOGLE_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.getenv("serper_API", "")

output_dir = base_dir / "outputs"
output_dir.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="TryOn AI Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/outputs", StaticFiles(directory=str(output_dir)), name="outputs")


class TryOnRequest(BaseModel):
    pose_image: str    # base64 data URL ("data:image/png;base64,...") or HTTP URL
    garment_image: str  # base64 data URL or HTTP URL


@app.get("/token")
async def get_stream_token(user_id: str = Query(default="demo-user")):
    """Generate a GetStream user token server-side using the API secret."""
    api_key = os.getenv("STREAM_API_KEY", "")
    api_secret = os.getenv("STREAM_API_SECRET", "")
    if not api_key or not api_secret:
        return JSONResponse({"error": "STREAM_API_KEY or STREAM_API_SECRET not set"}, status_code=503)
    try:
        from getstream import Stream
        client = Stream(api_key=api_key, api_secret=api_secret)
        token = client.create_token(user_id)
        return {"token": token, "user_id": user_id, "api_key": api_key}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/health")
async def health():
    api_key = os.getenv("GOOGLE_API_KEY", "")
    return {
        "status": "ok",
        "api_key_set": bool(api_key),
        "model": os.getenv("NANO_BANANA_MODEL", "gemini-2.5-flash-preview-05-20"),
    }


_MODEL_RENAMES = {
    "gemini-2.0-flash-exp-image-generation": "gemini-2.5-flash-image",
    "gemini-2.0-flash-preview-image-generation": "gemini-2.5-flash-image",
    "gemini-2.0-flash-exp": "gemini-2.5-flash-image",
    "gemini-2.5-flash-preview-05-20": "gemini-2.5-flash-image",
}


@app.post("/tryon")
async def tryon(request: TryOnRequest):
    api_key = os.getenv("GOOGLE_API_KEY", "")
    model = os.getenv("NANO_BANANA_MODEL", "gemini-2.5-flash-image")
    model = _MODEL_RENAMES.get(model, model)

    processor = NanoBananaProcessor(
        api_key=api_key or None,
        model=model,
        output_dir=str(output_dir),
    )

    await processor.set_pose_image(request.pose_image)
    await processor.set_merchandise(request.garment_image)
    result = await processor.generate_tryon()

    # Map local file path to a URL the frontend can load via Vite proxy /outputs/
    if result.get("status") == "success" and result.get("local_image_path"):
        filename = Path(result["local_image_path"]).name
        result["image_url"] = f"/outputs/{filename}"

    return JSONResponse(content=result)

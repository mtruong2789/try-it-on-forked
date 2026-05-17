"""
Minimal FastAPI server for TryOn AI demo.
Exposes:
- /tryon: accepts webcam + garment images and returns generated try-on image
- /search-garment: finds a web-store product image from a text prompt using Serper + Groq

Run with:
    uvicorn server:app --reload --port 8000
"""

import imghdr
import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

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
    pose_image: str  # base64 data URL ("data:image/png;base64,...") or HTTP URL
    garment_image: str  # base64 data URL or HTTP URL


class GarmentSearchRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=180)


def _post_json(url: str, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
    req = urllib_request.Request(
        url=url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    with urllib_request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _looks_like_image_url(url: str) -> bool:
    lowered = url.lower()
    return lowered.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"))


def _extract_domain(url: str) -> str:
    try:
        return urllib_parse.urlparse(url).netloc.replace("www.", "")
    except Exception:
        return ""


def _is_http_url(url: str) -> bool:
    return isinstance(url, str) and url.startswith(("http://", "https://"))


def _sanitize_candidates(candidates: list[dict[str, str]]) -> list[dict[str, str]]:
    deduped: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()

    for candidate in candidates:
        product_url = (candidate.get("product_url") or "").strip()
        image_url = (candidate.get("image_url") or "").strip()
        title = (candidate.get("title") or "Product").strip() or "Product"
        if not _is_http_url(product_url) or not _is_http_url(image_url):
            continue
        domain = candidate.get("domain") or _extract_domain(product_url)
        key = (domain, image_url)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(
            {
                "title": title,
                "product_url": product_url,
                "image_url": image_url,
                "domain": domain,
            }
        )

    return deduped


def _collect_serper_candidates(prompt: str) -> list[dict[str, str]]:
    serper_key = os.getenv("SERPER_API_KEY") or os.getenv("serper_API")
    if not serper_key:
        raise RuntimeError("SERPER_API_KEY (or serper_API) is not set.")

    headers = {"X-API-KEY": serper_key}
    candidates: list[dict[str, str]] = []

    shopping_payload = {"q": prompt, "num": 10}
    shopping_data = _post_json("https://google.serper.dev/shopping", shopping_payload, headers)
    for item in shopping_data.get("shopping", []) or []:
        product_url = item.get("link") or ""
        image_url = item.get("imageUrl") or item.get("image") or ""
        title = item.get("title") or item.get("source") or "Product"
        if product_url and image_url:
            candidates.append(
                {
                    "title": title,
                    "product_url": product_url,
                    "image_url": image_url,
                    "domain": _extract_domain(product_url),
                }
            )

    candidates = _sanitize_candidates(candidates)
    if candidates:
        return candidates

    image_payload = {"q": f"{prompt} product", "num": 12}
    image_data = _post_json("https://google.serper.dev/images", image_payload, headers)
    for item in image_data.get("images", []) or []:
        image_url = item.get("imageUrl") or ""
        product_url = item.get("link") or item.get("source") or ""
        title = item.get("title") or "Product"
        if not image_url and isinstance(product_url, str) and _looks_like_image_url(product_url):
            image_url = product_url
            product_url = item.get("source") or ""
        if image_url and product_url:
            candidates.append(
                {
                    "title": title,
                    "product_url": product_url,
                    "image_url": image_url,
                    "domain": _extract_domain(product_url),
                }
            )

    return _sanitize_candidates(candidates)


def _pick_candidate_with_groq(prompt: str, candidates: list[dict[str, str]]) -> dict[str, str]:
    if not candidates:
        return {}

    groq_key = os.getenv("groq_API") or os.getenv("GROQ_API_KEY")
    if not groq_key or len(candidates) == 1:
        return candidates[0]

    groq_model = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
    shortlist = candidates[:8]
    options = [{"index": i, **c} for i, c in enumerate(shortlist)]

    try:
        response = _post_json(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                "model": groq_model,
                "temperature": 0,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You are selecting the best ecommerce product match for a clothing prompt. "
                            "Prefer direct product pages from real stores, clear title relevance, and plausible product photos. "
                            "Return strict JSON only: {\"index\": <integer>}."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps({"prompt": prompt, "options": options}, ensure_ascii=False),
                    },
                ],
            },
            {"Authorization": f"Bearer {groq_key}"},
        )
        content = (
            response.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            .strip()
        )
        chosen_index = None
        if content:
            try:
                chosen_index = int(json.loads(content).get("index"))
            except Exception:
                match = re.search(r"(\d+)", content)
                if match:
                    chosen_index = int(match.group(1))
        if chosen_index is not None and 0 <= chosen_index < len(shortlist):
            return shortlist[chosen_index]
    except Exception:
        pass

    return shortlist[0]


def _guess_extension(image_bytes: bytes, content_type: str = "") -> str:
    detected = imghdr.what(None, image_bytes)
    if detected == "jpeg":
        return ".jpg"
    if detected == "png":
        return ".png"
    if detected == "webp":
        return ".webp"
    if detected == "gif":
        return ".gif"
    if detected:
        return f".{detected}"

    lowered = (content_type or "").lower()
    if "jpeg" in lowered:
        return ".jpg"
    if "png" in lowered:
        return ".png"
    if "webp" in lowered:
        return ".webp"
    if "gif" in lowered:
        return ".gif"
    return ".jpg"


def _download_image_bytes(url: str) -> tuple[bytes, str]:
    req = urllib_request.Request(
        url=url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; TryOnAI/1.0)"},
        method="GET",
    )
    with urllib_request.urlopen(req, timeout=20) as resp:
        content_type = resp.headers.get("Content-Type", "")
        image_bytes = resp.read()
    return image_bytes, content_type


def _cache_candidate_image(candidate: dict[str, str], prompt: str) -> dict[str, str] | None:
    image_url = (candidate.get("image_url") or "").strip()
    if not _is_http_url(image_url):
        return None

    try:
        image_bytes, content_type = _download_image_bytes(image_url)
    except Exception:
        return None

    if len(image_bytes) < 12_000:
        return None

    kind = imghdr.what(None, image_bytes)
    if not kind and "image/" not in (content_type or "").lower():
        return None

    safe_prompt = re.sub(r"[^a-z0-9]+", "-", prompt.lower()).strip("-")[:32] or "garment"
    ext = _guess_extension(image_bytes, content_type)
    filename = f"garment_{safe_prompt}_{int(time.time())}_{uuid.uuid4().hex[:8]}{ext}"
    out_path = output_dir / filename
    out_path.write_bytes(image_bytes)

    return {
        "title": candidate.get("title") or "Product match",
        "product_url": candidate.get("product_url") or "",
        "image_url": f"/outputs/{filename}",
        "domain": candidate.get("domain") or _extract_domain(candidate.get("product_url", "")),
        "provider": "serper+groq",
    }


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


@app.post("/search-garment")
async def search_garment(request: GarmentSearchRequest):
    prompt = request.prompt.strip()
    if not prompt:
        return JSONResponse({"status": "error", "message": "Prompt is required."}, status_code=400)

    try:
        candidates = _collect_serper_candidates(prompt)
    except RuntimeError as e:
        return JSONResponse({"status": "error", "message": str(e)}, status_code=503)
    except urllib_error.HTTPError as e:
        return JSONResponse(
            {"status": "error", "message": f"Serper request failed ({e.code})."},
            status_code=502,
        )
    except Exception as e:
        return JSONResponse({"status": "error", "message": f"Search failed: {e}"}, status_code=500)

    if not candidates:
        return JSONResponse(
            {"status": "error", "message": "No matching web-store product found. Try a more specific prompt."},
            status_code=404,
        )

    selected = _pick_candidate_with_groq(prompt, candidates)
    if not selected.get("image_url") or not selected.get("product_url"):
        return JSONResponse(
            {
                "status": "error",
                "message": "Could not resolve a valid product page + image.",
                "debug": {
                    "candidate_count": len(candidates),
                    "selected_candidate_has_urls": False,
                },
            },
            status_code=404,
        )

    selected_index = next(
        (
            i for i, c in enumerate(candidates)
            if c.get("image_url") == selected.get("image_url") and c.get("product_url") == selected.get("product_url")
        ),
        -1,
    )

    ordered_candidates = [selected] + [
        c for c in candidates
        if c.get("image_url") != selected.get("image_url") or c.get("product_url") != selected.get("product_url")
    ]

    attempted: list[dict[str, Any]] = []
    cached_result = None
    for idx, candidate in enumerate(ordered_candidates[:8]):
        cached_result = _cache_candidate_image(candidate, prompt)
        attempted.append(
            {
                "attempt": idx + 1,
                "domain": candidate.get("domain") or _extract_domain(candidate.get("product_url", "")),
                "title": (candidate.get("title") or "Product")[:90],
                "cached": bool(cached_result),
            }
        )
        if cached_result:
            break

    if not cached_result:
        return JSONResponse(
            {
                "status": "error",
                "message": "Found products, but image sources were blocked or invalid. Try another prompt.",
                "debug": {
                    "candidate_count": len(candidates),
                    "selected_index": selected_index,
                    "attempted_candidates": attempted,
                },
            },
            status_code=502,
        )

    return JSONResponse(
        {
            "status": "success",
            "title": cached_result.get("title") or "Product match",
            "product_url": cached_result.get("product_url"),
            "image_url": cached_result.get("image_url"),
            "domain": cached_result.get("domain") or _extract_domain(cached_result.get("product_url", "")),
            "provider": cached_result.get("provider") or "serper+groq",
            "debug": {
                "candidate_count": len(candidates),
                "selected_index": selected_index,
                "attempted_candidates": attempted,
            },
        }
    )


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

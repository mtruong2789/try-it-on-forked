import asyncio
import base64
import hashlib
import io
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types
from PIL import Image

try:
    import pillow_avif  # registers AVIF support with Pillow  # noqa: F401
except ImportError:
    pass


class NanoBananaProcessor:
    """
    Lightweight try-on processor for vision-agents pipeline.

    Design:
    - `process(frame)` is called on each incoming video frame from GetStream.
    - We cache the latest frame for snapshot-based try-on generation.
    - `generate_tryon()` runs on demand (LLM function or external trigger) to avoid
      expensive per-frame generation.
    """

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "gemini-2.5-flash-image",
        output_dir: str | Path = "outputs",
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.call: Any | None = None
        self.merchandise_image: str | None = None
        self.pose_image: str | None = None
        self.latest_frame: Any | None = None

        self._inflight_lock = asyncio.Lock()

    def attach_call(self, call: Any) -> None:
        self.call = call

    async def process(self, frame: Any) -> Any:
        # Keep video pipeline real-time: store frame and return immediately.
        self.latest_frame = frame
        return frame

    async def set_merchandise(self, image_path_or_url: str) -> str:
        self.merchandise_image = image_path_or_url.strip()
        return self.merchandise_image

    async def set_pose_image(self, image_path_or_url: str) -> str:
        self.pose_image = image_path_or_url.strip()
        return self.pose_image

    async def clear_merchandise(self) -> None:
        self.merchandise_image = None

    async def clear_pose_image(self) -> None:
        self.pose_image = None

    async def generate_tryon(self) -> dict[str, Any]:
        start = time.perf_counter()

        if self.pose_image is None and self.latest_frame is None:
            return {
                "status": "error",
                "reason": "no_pose_or_frame_available",
                "message": "No captured pose image or video frame has been received yet.",
            }

        if not self.merchandise_image:
            return {
                "status": "error",
                "reason": "missing_merchandise",
                "message": "Please set a merchandise image first.",
            }

        if self._inflight_lock.locked():
            return {
                "status": "busy",
                "message": "A try-on generation is already in progress.",
            }

        async with self._inflight_lock:
            job_id = str(uuid.uuid4())
            result = await self._run_tryon(job_id)

            latency_ms = int((time.perf_counter() - start) * 1000)
            result["job_id"] = job_id
            result["latency_ms"] = latency_ms
            return result

    async def emit_result(self, result: dict[str, Any]) -> None:
        if self.call is None:
            return

        status = result.get("status", "unknown")
        payload = {
            "event": "mirror_update",
            "job_id": result.get("job_id"),
            "item_id": result.get("item_id"),
            "status": status,
            "image_url": result.get("image_url"),
            "source_image_url": self.merchandise_image,
            "latency_ms": result.get("latency_ms"),
            "reason": result.get("reason"),
            "message": result.get("message"),
            "error_message": result.get("message") if status != "success" else "",
        }

        try:
            maybe_coro = self.call.send_custom_event("mirror_update", payload)
            if asyncio.iscoroutine(maybe_coro):
                await maybe_coro
        except Exception:
            # Non-fatal: keep agent stable even if custom events are unsupported.
            pass

    @staticmethod
    def _is_url(value: str) -> bool:
        return value.startswith("http://") or value.startswith("https://")

    @staticmethod
    def _decode_maybe_base64(data: bytes | str) -> bytes:
        if isinstance(data, bytes):
            return data
        try:
            return base64.b64decode(data, validate=True)
        except Exception:
            return data.encode("utf-8")

    @staticmethod
    def _looks_like_image_bytes(data: bytes) -> bool:
        if not data:
            return False
        signatures = (
            b"\x89PNG\r\n\x1a\n",
            b"\xff\xd8\xff",
            b"GIF87a",
            b"GIF89a",
            b"RIFF",
            b"BM",
        )
        if any(data.startswith(sig) for sig in signatures):
            return True
        if data[:12].startswith(b"RIFF") and b"WEBP" in data[:16]:
            return True
        return False

    @staticmethod
    def _images_nearly_identical(bytes_a: bytes, bytes_b: bytes) -> bool:
        """
        Compare two images at 32×32 thumbnail scale using mean squared error (MSE).
        Returns True only when the images are visually indistinguishable — i.e. the
        model returned the input photo unchanged (possibly with slight re-encoding).

        MSE guide at 32×32:
          0–5   → byte-for-byte identical or trivial re-encode noise (UNCHANGED)
          5–10  → extremely close, almost certainly unchanged
          10+   → a real visual difference exists somewhere in the image
        We use a threshold of 10 to be conservative — only flag near-perfect copies.
        """
        try:
            size = (32, 32)
            a = Image.open(io.BytesIO(bytes_a)).convert("RGB").resize(size, Image.LANCZOS)
            b = Image.open(io.BytesIO(bytes_b)).convert("RGB").resize(size, Image.LANCZOS)
            pixels_a = list(a.getdata())
            pixels_b = list(b.getdata())
            mse = sum(
                (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2
                for (r1, g1, b1), (r2, g2, b2) in zip(pixels_a, pixels_b)
            ) / (len(pixels_a) * 3)
            return mse < 10.0
        except Exception:
            return False

    @staticmethod
    def _normalize_to_png(image_bytes: bytes) -> bytes:
        """
        Convert any image format (AVIF, WebP, HEIC, JPEG, GIF, BMP, etc.) to PNG bytes.
        This ensures Gemini always receives a well-formed PNG regardless of source format.
        """
        try:
            img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
            # Flatten transparency onto white background for garment images
            background = Image.new("RGBA", img.size, (255, 255, 255, 255))
            background.paste(img, mask=img.split()[3] if img.mode == "RGBA" else None)
            img = background.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return buf.getvalue()
        except Exception:
            # If PIL can't open it, return as-is and let the API handle it
            return image_bytes

    def _read_image_bytes_from_path_or_url(self, source: str) -> bytes:
        source = source.strip()

        if source.startswith("data:"):
            header, encoded = source.split(",", 1)
            if ";base64" in header:
                raw = base64.b64decode(encoded, validate=False)
            else:
                raw = urllib.parse.unquote_to_bytes(encoded)
            return raw

        if self._is_url(source):
            request = urllib.request.Request(
                source,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; TryOnAI/1.0)",
                    "Accept": "image/*,*/*;q=0.8",
                },
            )
            with urllib.request.urlopen(request, timeout=20) as response:
                return response.read()
        return Path(source).read_bytes()

    @staticmethod
    def _format_source_fetch_error(
        source_label: str,
        source_value: str,
        exc: Exception,
    ) -> dict[str, str]:
        if isinstance(exc, urllib.error.HTTPError):
            hint = ""
            if exc.code == 403:
                hint = " Source URL is blocked (403). Use a local file path or publicly accessible URL."
            return {
                "status": "error",
                "reason": f"{source_label}_fetch_failed",
                "message": (
                    f"Failed to fetch {source_label.replace('_', ' ')} from '{source_value}': "
                    f"HTTP {exc.code} {exc.reason}.{hint}"
                ),
            }

        if isinstance(exc, urllib.error.URLError):
            return {
                "status": "error",
                "reason": f"{source_label}_fetch_failed",
                "message": (
                    f"Failed to fetch {source_label.replace('_', ' ')} from '{source_value}': "
                    f"{exc.reason}"
                ),
            }

        if isinstance(exc, FileNotFoundError):
            return {
                "status": "error",
                "reason": f"{source_label}_fetch_failed",
                "message": (
                    f"Failed to read {source_label.replace('_', ' ')} at '{source_value}': "
                    "file not found."
                ),
            }

        return {
            "status": "error",
            "reason": f"{source_label}_fetch_failed",
            "message": f"Failed to fetch {source_label.replace('_', ' ')}: {exc}",
        }

    def _classify_model_error(self, exc: Exception) -> dict[str, str]:
        text = str(exc)
        lower_text = text.lower()
        status_code = getattr(exc, "status_code", None)

        if status_code == 429 or "resource_exhausted" in lower_text or "quota exceeded" in lower_text:
            return {
                "status": "error",
                "reason": "model_quota_exhausted",
                "message": (
                    "Model quota exceeded. Check billing/quota limits and retry. "
                    f"Details: {text}"
                ),
            }

        if status_code == 403 or "forbidden" in lower_text or "permission denied" in lower_text:
            return {
                "status": "error",
                "reason": "model_access_forbidden",
                "message": (
                    "Model access is forbidden for this API key/project. "
                    "Verify model entitlement and API permissions. "
                    f"Details: {text}"
                ),
            }

        if "invalid argument" in lower_text or "not found" in lower_text or "unsupported" in lower_text:
            return {
                "status": "error",
                "reason": "invalid_model_or_request",
                "message": (
                    f"Invalid model/request for '{self.model}'. "
                    f"Details: {text}"
                ),
            }

        return {
            "status": "error",
            "reason": "tryon_generation_failed",
            "message": f"Try-on generation failed: {text}",
        }

    def _image_bytes_from_frame(self, frame: Any) -> bytes:
        if isinstance(frame, (bytes, bytearray, memoryview)):
            return bytes(frame)

        if isinstance(frame, Image.Image):
            image = frame.convert("RGB")
        elif hasattr(frame, "to_ndarray"):
            ndarray = frame.to_ndarray(format="rgb24")
            image = Image.fromarray(ndarray).convert("RGB")
        elif hasattr(frame, "__array_interface__") or hasattr(frame, "shape"):
            image = Image.fromarray(frame).convert("RGB")
        else:
            raise ValueError(f"Unsupported frame type for image conversion: {type(frame)}")

        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue()

    @staticmethod
    def _extract_inline_image_bytes(response: Any) -> bytes | None:
        candidates = getattr(response, "candidates", None) or []
        for candidate in candidates:
            content = getattr(candidate, "content", None)
            parts = getattr(content, "parts", None) or []
            for part in parts:
                inline_data = getattr(part, "inline_data", None)
                if not inline_data:
                    continue
                data = getattr(inline_data, "data", None)
                if data:
                    decoded = NanoBananaProcessor._decode_maybe_base64(data)
                    if decoded.startswith(b"\x89PNG") or decoded.startswith(b"\xff\xd8\xff"):
                        return decoded

        generated_images = getattr(response, "generated_images", None) or []
        for image_obj in generated_images:
            image = getattr(image_obj, "image", None)
            image_bytes = getattr(image, "image_bytes", None) if image else None
            if image_bytes:
                decoded = NanoBananaProcessor._decode_maybe_base64(image_bytes)
                if decoded.startswith(b"\x89PNG") or decoded.startswith(b"\xff\xd8\xff"):
                    return decoded
        return None

    @staticmethod
    def _to_browser_image_url(output_file: Path, image_bytes: bytes) -> str:
        """
        Prefer a URL path when output is written under try-on-react/public.
        Fall back to a data URL so frontend can still render without static hosting.
        """
        resolved = output_file.resolve()
        public_marker = "/try-on-react/public/"
        resolved_str = resolved.as_posix()
        marker_index = resolved_str.find(public_marker)
        if marker_index >= 0:
            relative = resolved_str[marker_index + len(public_marker):]
            return f"/{relative}"

        encoded = base64.b64encode(image_bytes).decode("ascii")
        return f"data:image/png;base64,{encoded}"

    async def _run_tryon(self, job_id: str) -> dict[str, Any]:
        """
        Real try-on invocation via Google GenAI image model.

        Input A: captured pose image (or latest frame fallback)
        Input B: selected merchandise image
        Output: generated try-on image saved locally and returned as image_url
        """
        if not self.api_key:
            return {
                "status": "error",
                "reason": "missing_api_key",
                "message": "GOOGLE_API_KEY is not set.",
            }

        if self.pose_image is not None:
            pose_source = self.pose_image
            try:
                base_image_bytes = await asyncio.to_thread(
                    self._read_image_bytes_from_path_or_url, self.pose_image
                )
            except Exception as exc:
                return self._format_source_fetch_error("pose_image", self.pose_image, exc)
        else:
            pose_source = "latest_frame"
            try:
                base_image_bytes = await asyncio.to_thread(
                    self._image_bytes_from_frame, self.latest_frame
                )
            except Exception as exc:
                return {
                    "status": "error",
                    "reason": "pose_image_fetch_failed",
                    "message": f"Failed to convert latest frame into image bytes: {exc}",
                }

        try:
            garment_image_bytes = await asyncio.to_thread(
                self._read_image_bytes_from_path_or_url, self.merchandise_image
            )
        except Exception as exc:
            return self._format_source_fetch_error(
                "merchandise_image",
                self.merchandise_image,
                exc,
            )

        # Normalize both images to PNG regardless of source format (handles AVIF, WebP, HEIC, etc.)
        base_image_bytes = await asyncio.to_thread(self._normalize_to_png, base_image_bytes)
        garment_image_bytes = await asyncio.to_thread(self._normalize_to_png, garment_image_bytes)

        # Detect same-image-twice: if pose and garment are identical, the model will
        # just return the input unchanged — catch this early and return a clear error.
        pose_hash = hashlib.md5(base_image_bytes).hexdigest()
        garment_hash = hashlib.md5(garment_image_bytes).hexdigest()
        if pose_hash == garment_hash:
            return {
                "status": "error",
                "reason": "identical_images",
                "message": "The pose photo and garment image appear to be the same. Please upload a different garment.",
            }

        client = genai.Client(api_key=self.api_key)

        # Interleave text labels with images so Gemini associates each label with its image.
        # Putting all text first then all images makes it much harder for the model to
        # correctly distinguish which image is the person vs. the garment reference.
        contents = [
            (
                "VIRTUAL TRY-ON TASK. I will give you two images and you must composite them.\n\n"
                "IMAGE 1 — The person. This is your base canvas. The output must look exactly like this photo."
            ),
            types.Part.from_bytes(data=base_image_bytes, mime_type="image/png"),
            (
                "IMAGE 2 — Clothing reference ONLY. "
                "This image may show a model, mannequin, product flat-lay, hanger, or a person wearing the clothing. "
                "Your ONLY job with IMAGE 2 is to extract the clothing/garment item — its shape, cut, color, pattern, and texture. "
                "You must completely discard and ignore EVERYTHING else in IMAGE 2: "
                "the person's face, skin, hair, body, makeup, face paint, masks, accessories, and background. "
                "None of those elements may appear in the output. Only the clothing transfers."
            ),
            types.Part.from_bytes(data=garment_image_bytes, mime_type="image/png"),
            (
                "IMPORTANT REMINDER about the image above (IMAGE 2): "
                "Extract ONLY the clothing/garment from it. "
                "If that image contains a face, mask, face paint, wig, or hair — those are NOT part of the clothing and must be completely discarded. "
                "Do NOT transfer any face, mask, makeup, hair colour, or wig from IMAGE 2 onto the person. Only the clothing transfers.\n\n"
                "Now produce the try-on composite. Follow ALL of these rules:\n\n"
                "RULE 1 — You MUST make a visible clothing change. Returning the original photo unchanged is never acceptable. "
                "If applying the garment is difficult, produce your best approximation — a partial result is always better than no result.\n\n"
                "RULE 2 — The garment must be applied to match exactly how it appears in IMAGE 2 — replicate the coverage, not more and not less. "
                "If IMAGE 2 shows both sleeves, both sleeves must appear on both arms in the output. "
                "If IMAGE 2 shows only one sleeve (e.g. one-shoulder or asymmetric design), replicate only that. "
                "If IMAGE 2 shows the full torso covered, the full torso must be covered in the output — do not leave half the chest showing the original clothing. "
                "If IMAGE 2 shows the garment open/closed, zipped/unzipped, tucked/untucked — match that exactly. "
                "Scale and fit the garment to the person's actual body dimensions from IMAGE 1, "
                "but always match the coverage and style of IMAGE 2 precisely.\n\n"
                "RULE 3 — Body estimation. If the person is wearing bulky, baggy, or heavily layered clothing that hides their body shape, "
                "you MUST estimate the body shape and proportions beneath it (using silhouette, posture, visible skin, and limb positions) "
                "and render the new garment fitted to that estimated body.\n\n"
                "RULE 4 — Skin visibility. If the new garment is more revealing than what the person is currently wearing "
                "(e.g. replacing a coat with a tank top, or applying a short dress or swimwear), "
                "you MUST render the skin that would naturally be visible. Do not cover it up or censor it. "
                "Show the actual skin of their arms, legs, shoulders, or midriff as the garment requires.\n\n"
                "RULE 5 — Only change what the reference garment dictates. "
                "Keep the person's bottoms (pants, skirt, shorts) unchanged if IMAGE 2 shows only a top. "
                "Keep the person's top unchanged if IMAGE 2 shows only a bottom. "
                "Change everything if IMAGE 2 shows a full outfit.\n\n"
                "RULE 6 — Arm and sleeve coverage is determined entirely by the new garment, NOT by what the person is currently wearing. "
                "Whatever sleeve or arm coverage exists in IMAGE 1 must be replaced to match IMAGE 2. Specifically:\n"
                "  - Tank top / camisole / spaghetti strap: the arms must be completely bare skin from shoulder to wrist. "
                "Remove ALL sleeve fabric — even if the person was wearing a long-sleeve shirt or hoodie underneath. The sleeves disappear entirely.\n"
                "  - T-shirt / short-sleeve top: arms are bare from mid-upper-arm to wrist. Remove any long sleeves.\n"
                "  - Long-sleeve shirt / hoodie / sweatshirt: full arms covered to the wrist.\n"
                "  - Jacket / coat / blazer / vest (outer layers): worn OVER existing clothing; underlayer visible at collar, cuffs, and hem.\n"
                "  - Strapless / off-shoulder: bare shoulders and upper arms.\n"
                "  - Swimwear / bikini: bare arms, bare legs, bare midriff.\n"
                "The key rule: if the new garment has no sleeves, the arms in the output must be completely bare skin from shoulder to wrist. "
                "This applies even if an arm is raised, extended, or in an unusual position. "
                "Preserving the pose means preserving the POSITION of the limbs — not the clothing on those limbs. "
                "A raised arm wearing a white hoodie sleeve must become a raised bare arm if the new garment is a tank top.\n"
                "CRITICAL: The replaced garment must be completely removed from the image — it must not appear anywhere. "
                "Do NOT show it pushed off the shoulders, hanging off the arms, bunched at the wrists, or partially worn. "
                "It is gone. Only the new garment and bare skin where appropriate should appear.\n\n"
                "RULE 7 — No restrictions on garment type. Apply ALL garment types faithfully: "
                "casual wear, formal wear, evening gowns, red carpet looks, theatrical costumes, fashion-forward designs, "
                "revealing outfits, fantasy wear — apply everything as-is without modification or omission.\n\n"
                "RULE 8 — Face not required. The person's face may be partially or fully hidden in IMAGE 1. "
                "That is fine — proceed with the try-on regardless.\n\n"
                "RULE 9 — ABSOLUTE LOCKS — these come from IMAGE 1 only and must NEVER be altered:\n"
                "  - The person's face, facial features, expression, and skin tone — do NOT apply any makeup, face paint, masks, or markings from IMAGE 2\n"
                "  - The person's hair — color, length, style, and position\n"
                "  - The person's existing makeup (or lack of makeup) — do not add or remove any\n"
                "  - The background, lighting, shadows, and camera angle\n"
                "  - All accessories not physically covered by the new garment (glasses, jewelry, shoes, bags)\n"
                "If IMAGE 2 contains face paint, clown makeup, a mask, or any facial modification — "
                "these are NOT clothing and must be completely ignored. They must not appear on the person in the output.\n\n"
                "Output: one single photorealistic image. No text, no watermarks, no captions, no explanation."
            ),
        ]

        # Try up to 2 times — Gemini occasionally returns the input image unchanged
        for attempt in range(2):
            try:
                response = await asyncio.to_thread(
                    client.models.generate_content,
                    model=self.model,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        response_modalities=["IMAGE", "TEXT"],
                    ),
                )
            except Exception as exc:
                return self._classify_model_error(exc)

            image_bytes = self._extract_inline_image_bytes(response)
            if not image_bytes:
                if attempt == 0:
                    continue
                return {
                    "status": "error",
                    "reason": "no_image_in_model_response",
                    "message": "Model response did not include an edited image.",
                }

            # Detect if the model returned an input image as an exact byte-for-byte copy
            result_hash = hashlib.md5(image_bytes).hexdigest()
            if result_hash in (pose_hash, garment_hash):
                if attempt == 0:
                    continue
                return {
                    "status": "error",
                    "reason": "model_returned_input_unchanged",
                    "message": "Generation failed after retry — the model returned the input unchanged. Please try again.",
                }

            # Detect re-encoded copies: same visual image but different bytes (MSE-based check).
            # Only compare against the pose image — that's the one the model tends to echo back.
            if self._images_nearly_identical(image_bytes, base_image_bytes):
                if attempt == 0:
                    continue
                return {
                    "status": "error",
                    "reason": "model_returned_input_unchanged",
                    "message": "Generation failed after retry — the model made no visible clothing change. Please try again.",
                }

            break

        output_file = self.output_dir / f"tryon_{job_id}.png"
        output_file.write_bytes(image_bytes)
        browser_image_url = self._to_browser_image_url(output_file, image_bytes)

        return {
            "status": "success",
            "image_url": browser_image_url,
            "local_image_path": str(output_file),
            "message": f"Try-on image generated from {pose_source}.",
        }

# tryon.ai — Virtual Fitting Room Demo

## How it works

1. Open your webcam (or upload a selfie)
2. Pick or upload an outfit photo
3. Click **Generate Try-On** — Gemini edits your photo to show you wearing the outfit

---

## Setup & Run

### 1. Python backend (FastAPI + Gemini)

```bash
cd my-agent
```

Make sure `.env` has your Google API key:
```
GOOGLE_API_KEY=your_key_here
# Optional model override (default: gemini-2.5-flash-preview-05-20):
# NANO_BANANA_MODEL=gemini-2.5-flash-preview-05-20
```

Install and start the server:
```bash
uv run uvicorn server:app --reload --port 8000
```

The server will be at `http://localhost:8000`. Check `http://localhost:8000/health` to confirm.

### 2. React frontend

```bash
cd try-on-react
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Demo flow

| Step | Action |
|------|--------|
| 1 | Click **Start Camera** to see your webcam feed |
| 2 | Stand in frame, then click **Take Photo** |
| 3 | Upload or choose an outfit from the catalog |
| 4 | Click **Generate Try-On** |
| 5 | Wait ~15–30s for Gemini to generate the result |

> You can also click **Upload Selfie** instead of using the webcam.

---

## Architecture

### Direct API mode (minimal setup)
```
Browser (React)
  ↓ POST /api/tryon  (Vite proxies → localhost:8000)
FastAPI server (server.py)
  ↓ NanoBananaProcessor → Gemini
  → image URL returned to browser
```

### GetStream mode (full integration)
Add Stream credentials to `try-on-react/.env`:
```
STREAM_API_KEY=...
STREAM_USER_ID=demo-user
STREAM_USER_TOKEN=...
STREAM_CALL_TYPE=default
STREAM_CALL_ID=tryon-demo
```

Then run the Stream-connected agent instead of the FastAPI server:
```bash
cd my-agent
uv run python main.py run --call-type default --call-id tryon-demo
```

```
Browser (React)  ──custom event──▶  GetStream
                                       │
                                  Python Agent (main.py)
                                  NanoBananaProcessor → Gemini
                                       │
Browser (React)  ◀─ mirror_update ──  GetStream
```

When Stream credentials aren't set, the frontend automatically falls back to the direct API.  
The "GetStream" status badge in the UI shows which mode is active.

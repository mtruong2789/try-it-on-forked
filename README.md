# tryon.ai — Virtual Fitting Room Demo

## How it works

1. Start the mirror and capture your photo
2. Describe an outfit to search web stores (or choose one from the catalog)
3. Click **Generate Try-On** — Gemini edits your photo to show you wearing the outfit

---

## Setup & Run

### 1) Configure environment variables

Create a `.env` at repo root (or `my-agent/.env`) with:

```env
GOOGLE_API_KEY=your_google_key
serper_API=your_serper_key
groq_API=your_groq_key

# Optional model override (default maps to gemini-2.5-flash-image)
# NANO_BANANA_MODEL=gemini-2.5-flash-preview-05-20

# Optional Stream setup
# STREAM_API_KEY=...
# STREAM_API_SECRET=...
```

### 2) Start everything with one command (recommended)

From repository root:

```bash
npm install
npm run dev
```

This starts all three services together:
- React frontend (`try-on-react`) via Vite
- Flask backend (`try-on-flask/backend.py`)
- FastAPI agent (`my-agent/server.py` on port `8000`)

> If Vite reports port 5173 is busy, it will auto-pick the next open port.

### 3) Manual startup (optional)

If you prefer separate terminals:

```bash
# Terminal 1
cd try-on-react && npm run dev

# Terminal 2
cd try-on-flask && python3 backend.py

# Terminal 3
cd my-agent && (uv run uvicorn server:app --port 8000 || python3 -m uvicorn server:app --port 8000)
```

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

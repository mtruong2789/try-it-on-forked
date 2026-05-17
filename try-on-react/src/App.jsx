import { useCallback, useEffect, useRef, useState } from 'react';
import { StreamVideoClient } from '@stream-io/video-react-sdk';
import './App.css';

const PRESET_GARMENTS = [
  {
    id: 'g1',
    name: 'Cyberpunk Bomber',
    category: 'Outerwear',
    imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400',
  },
  {
    id: 'g2',
    name: 'Classic Denim Jacket',
    category: 'Outerwear',
    imageUrl: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=400',
  },
  {
    id: 'g3',
    name: 'Oversized Linen Shirt',
    category: 'Tops',
    imageUrl: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400',
  },
  {
    id: 'g4',
    name: 'Minimalist Black Tee',
    category: 'Tops',
    imageUrl: 'https://images.unsplash.com/photo-1527719327859-c6ce80353573?w=400',
  },
];

const StreamLogo = () => (
  <svg height="18" viewBox="0 0 120 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Stream">
    <path d="M10.5 4L4 14l6.5 10h13L30 14 23.5 4h-13z" fill="#005fff" />
    <text x="36" y="20" fontFamily="system-ui,sans-serif" fontWeight="700" fontSize="16" fill="#fff">Stream</text>
  </svg>
);

export default function App() {
  // Mirror / camera state
  const [isMirrorOn, setIsMirrorOn] = useState(false);
  const [basePhotoUrl, setBasePhotoUrl] = useState('');   // captured frame of the user
  const [cameraError, setCameraError] = useState('');

  // Outfit state
  const [selectedPresetId, setSelectedPresetId] = useState(null);
  const [customOutfitUrl, setCustomOutfitUrl] = useState('');

  // Generation / result
  const [resultUrl, setResultUrl] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);
  const [status, setStatus] = useState('Start the mirror, take a photo of yourself, then upload the outfit you want to wear.');

  // Backend
  const [backendStatus, setBackendStatus] = useState('checking');

  // GetStream
  const [streamStatus, setStreamStatus] = useState('connecting');
  const streamCallRef = useRef(null);
  const streamClientRef = useRef(null);

  const videoRef = useRef(null);
  const outfitInputRef = useRef(null);
  const generateTimeoutRef = useRef(null);
  const streamUnsubRef = useRef(null);

  // Derived
  const activeOutfitUrl =
    customOutfitUrl ||
    (selectedPresetId ? PRESET_GARMENTS.find((g) => g.id === selectedPresetId)?.imageUrl : '');
  const canGenerate = Boolean(activeOutfitUrl) && Boolean(basePhotoUrl) && !isGenerating;

  // ── Mirror update handler (called from GetStream event) ───────────────────

  const handleMirrorUpdateEvent = useCallback((payload) => {
    const imageUrl = payload?.image_url;
    const errMsg = payload?.status !== 'success' ? (payload?.message || payload?.reason) : '';

    if (typeof imageUrl === 'string' && imageUrl.trim()) {
      if (generateTimeoutRef.current) { clearTimeout(generateTimeoutRef.current); generateTimeoutRef.current = null; }
      setResultUrl(imageUrl);
      setShowResult(true);
      setIsGenerating(false);
      setStatus('Try-on ready! Showing result.');
    }
    if (errMsg) {
      if (generateTimeoutRef.current) { clearTimeout(generateTimeoutRef.current); generateTimeoutRef.current = null; }
      setIsGenerating(false);
      setCameraError(`Backend: ${errMsg}`);
      setStatus('Generation failed.');
    }
  }, []);

  // ── GetStream init — video call replaces the webcam ───────────────────────

  useEffect(() => {
    const callType = import.meta.env.VITE_STREAM_CALL_TYPE || 'default';
    const callId = import.meta.env.VITE_STREAM_CALL_ID || 'tryon-demo';
    const userId = import.meta.env.VITE_STREAM_USER_ID || 'demo-user';

    // Fetch token + api key from the backend — no need to put them in .env
    let cancelled = false;
    fetch(`/api/token?user_id=${encodeURIComponent(userId)}`)
      .then((r) => r.json())
      .then(({ token, api_key, error }) => {
        if (cancelled) return;
        if (error || !token || !api_key) {
          console.warn('Stream token fetch failed:', error);
          setStreamStatus('unconfigured');
          return;
        }
        initStream({ apiKey: api_key, userId, token, callType, callId });
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('Could not fetch Stream token:', err.message);
          setStreamStatus('unconfigured');
        }
      });

    return () => {
      cancelled = true;
      if (generateTimeoutRef.current) clearTimeout(generateTimeoutRef.current);
      const call = streamCallRef.current;
      const client = streamClientRef.current;
      if (call) call.leave().catch(() => {});
      if (client) client.disconnectUser().catch(() => {});
      window.streamCall = null;
      streamCallRef.current = null;
      streamClientRef.current = null;
    };

    function initStream({ apiKey, userId, token, callType, callId }) {
      const client = new StreamVideoClient({
        apiKey,
        user: { id: userId, name: 'Demo User' },
        token,
      });
      streamClientRef.current = client;

      const call = client.call(callType, callId);
      streamCallRef.current = call;

      call.join({ create: true })
        .then(() => {
          window.streamCall = call;
          setStreamStatus('connected');

          call.on('custom', (event) => {
            const type = event?.type || event?.custom?.type;
            const payload = event?.payload || event?.custom?.payload || event?.custom || {};
            if (type === 'mirror_update') handleMirrorUpdateEvent(payload?.payload ?? payload);
          });
        })
        .catch((err) => {
          console.warn('GetStream join failed:', err?.message || err);
          setStreamStatus('error');
        });
    }
  }, [handleMirrorUpdateEvent]);

  // ── Mirror on/off — uses GetStream camera when connected, native fallback ─

  const stopMirror = useCallback(async () => {
    if (streamUnsubRef.current) {
      streamUnsubRef.current();
      streamUnsubRef.current = null;
    }
    const call = streamCallRef.current;
    if (call && streamStatus === 'connected') {
      try { await call.camera.disable(); } catch { /* best effort */ }
    }
    if (videoRef.current) {
      const tracks = videoRef.current.srcObject?.getTracks?.() || [];
      tracks.forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsMirrorOn(false);
  }, [streamStatus]);

  const startMirror = useCallback(async () => {
    setCameraError('');
    const call = streamCallRef.current;

    try {
      let mediaStream;

      if (call && streamStatus === 'connected') {
        // Use GetStream's camera — it manages permissions and device selection
        await call.camera.enable();

        // Pull the MediaStream from the Stream camera state
        mediaStream = call.camera.state.mediaStream;

        // Subscribe to mediaStream changes (Stream may swap tracks after constraints settle)
        const sub = call.camera.state$?.subscribe?.((s) => {
          if (s.mediaStream && videoRef.current) {
            videoRef.current.srcObject = s.mediaStream;
          }
        });
        // Store unsubscribe for cleanup
        streamUnsubRef.current = sub?.unsubscribe?.bind(sub) || null;
      } else {
        // Fallback: native getUserMedia
        if (!navigator.mediaDevices?.getUserMedia) {
          setCameraError('Camera not available. Check browser permissions.');
          return;
        }
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false,
        });
      }

      if (videoRef.current && mediaStream) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.muted = true;
        await videoRef.current.play().catch(() => {});
      }

      setIsMirrorOn(true);
      setShowResult(false);
      setStatus('Mirror active — pose and click Take Photo when ready.');
    } catch (err) {
      const code = err?.name || 'UnknownError';
      if (code === 'NotAllowedError' || code === 'SecurityError') {
        setCameraError('Camera permission denied. Enable it in browser settings.');
      } else if (code === 'NotFoundError') {
        setCameraError('No camera found.');
      } else {
        setCameraError(`Camera error: ${err?.message || code}`);
      }
    }
  }, [streamStatus]);

  const toggleMirror = useCallback(async () => {
    if (isMirrorOn) {
      await stopMirror();
      setStatus('Mirror off.');
    } else {
      await startMirror();
    }
  }, [isMirrorOn, startMirror, stopMirror]);

  useEffect(() => () => { stopMirror(); }, [stopMirror]);

  // ── Capture base photo from the mirror ────────────────────────────────────

  const handleTakePhoto = useCallback(() => {
    if (!isMirrorOn) { setCameraError('Start the mirror first.'); return; }
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) {
      setCameraError('Video not ready yet. Wait a moment and try again.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    // Mirror the canvas to match the flipped display
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setBasePhotoUrl(dataUrl);
    setCameraError('');
    setStatus(activeOutfitUrl ? 'Photo taken! Click Generate Try-On.' : 'Photo taken! Now upload or select the outfit you want to wear.');
  }, [isMirrorOn, activeOutfitUrl]);

  // ── Outfit upload ─────────────────────────────────────────────────────────

  const handleOutfitUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:image/')) {
        setCustomOutfitUrl(reader.result);
        setSelectedPresetId(null);
        setCameraError('');
        setStatus(basePhotoUrl ? 'Outfit ready! Click Generate Try-On.' : 'Outfit ready! Now take a photo of yourself in the mirror.');
      } else {
        setCameraError('Please upload a valid image file.');
      }
    };
    reader.readAsDataURL(file);
  }, [basePhotoUrl]);

  const handlePresetSelect = useCallback((id) => {
    setSelectedPresetId(id);
    setCustomOutfitUrl('');
    setStatus(basePhotoUrl ? 'Outfit selected! Click Generate Try-On.' : 'Outfit selected! Now take a photo of yourself in the mirror.');
  }, [basePhotoUrl]);

  // ── Backend health check ──────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setBackendStatus(d.api_key_set ? 'online' : 'no-key'))
      .catch(() => setBackendStatus('offline'));
  }, []);

  // ── Compress image before sending ────────────────────────────────────────

  const compressDataUrl = useCallback(async (dataUrl) => {
    if (!dataUrl.startsWith('data:image/')) return dataUrl;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(896 / img.width, 896 / img.height, 1);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(dataUrl); return; }
        ctx.drawImage(img, 0, 0, w, h);
        let q = 0.82;
        let out = canvas.toDataURL('image/jpeg', q);
        while (out.length > 220_000 && q > 0.45) { q -= 0.1; out = canvas.toDataURL('image/jpeg', q); }
        resolve(out.length < dataUrl.length ? out : dataUrl);
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }, []);

  // ── Send GetStream custom event ───────────────────────────────────────────

  const sendStreamEvent = useCallback(async (type, payload) => {
    const call = streamCallRef.current;
    if (!call || streamStatus !== 'connected') return false;
    try {
      const p = call.sendCustomEvent({ type, payload });
      if (p?.then) await p;
      return true;
    } catch {
      try {
        const p = call.sendCustomEvent({ type, ...payload });
        if (p?.then) await p;
        return true;
      } catch { return false; }
    }
  }, [streamStatus]);

  // ── Generate try-on ───────────────────────────────────────────────────────

  const callDirectApi = useCallback(async (poseImage, outfitImage) => {
    try {
      const res = await fetch('/api/tryon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pose_image: poseImage, garment_image: outfitImage }),
      });

      let data;
      try {
        data = await res.json();
      } catch {
        const text = await res.text().catch(() => '');
        throw new Error(
          res.ok
            ? `Server returned unreadable response (${res.status})`
            : `Server error ${res.status}${text ? ': ' + text.slice(0, 200) : ' (no body)'}`
        );
      }

      if (data.status === 'success' && data.image_url) {
        setResultUrl(data.image_url);
        setShowResult(true);
        setStatus('Try-on ready!');
      } else {
        setCameraError(data.message || data.reason || `Generation failed (status: ${data.status})`);
        setStatus('Generation failed. See error above.');
      }
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setCameraError('Cannot reach backend. Run: cd my-agent && uv run uvicorn server:app --port 8000');
      } else {
        setCameraError(msg);
      }
      setStatus('Generation failed.');
    } finally {
      setIsGenerating(false);
      generateTimeoutRef.current = null;
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;

    setIsGenerating(true);
    setResultUrl('');
    setShowResult(false);
    setCameraError('');

    const poseImage = await compressDataUrl(basePhotoUrl);
    const outfitImage = activeOutfitUrl;

    // Try GetStream path first (Python agent via main.py receives this)
    const sentViaStream = await sendStreamEvent('generate_tryon', {
      request_id: `tryon-${Date.now()}`,
      provider: 'nanobanana',
      image_url: outfitImage,
      pose_image_url: poseImage,
    });

    if (sentViaStream) {
      setStatus('Request sent via GetStream — waiting for backend agent…');
      // Fall back to direct API after 30 s if no mirror_update event arrives
      generateTimeoutRef.current = setTimeout(async () => {
        setStatus('No Stream response. Trying direct API…');
        await callDirectApi(poseImage, outfitImage);
      }, 30_000);
      return;
    }

    // Direct API path (server.py)
    setStatus('Sending to Gemini — this takes 10–30 seconds…');
    await callDirectApi(poseImage, outfitImage);
  }, [canGenerate, basePhotoUrl, activeOutfitUrl, compressDataUrl, sendStreamEvent, callDirectApi]);

  // ── Save result photo ─────────────────────────────────────────────────────

  const handleSavePhoto = useCallback(async () => {
    if (!resultUrl) return;
    try {
      let blobUrl = resultUrl;
      if (!resultUrl.startsWith('data:')) {
        const res = await fetch(resultUrl);
        const blob = await res.blob();
        blobUrl = URL.createObjectURL(blob);
      }
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `tryon-${Date.now()}.png`;
      a.click();
      if (!resultUrl.startsWith('data:')) URL.revokeObjectURL(blobUrl);
    } catch {
      setCameraError('Could not save photo. Try right-clicking the image and saving manually.');
    }
  }, [resultUrl]);

  // ── Computed labels ───────────────────────────────────────────────────────

  const streamLabel =
    streamStatus === 'connected' ? 'Stream Connected' :
    streamStatus === 'connecting' ? 'Stream Connecting…' :
    streamStatus === 'error' ? 'Stream Error' :
    streamStatus === 'unconfigured' ? 'Stream (not configured)' : '';

  const streamBadgeClass =
    streamStatus === 'connected' ? 'online' :
    streamStatus === 'connecting' ? 'degraded' :
    streamStatus === 'error' ? 'error' : 'offline';

  const backendLabel =
    backendStatus === 'online' ? 'API Ready' :
    backendStatus === 'no-key' ? 'Missing API Key' :
    backendStatus === 'offline' ? 'API Offline' : 'Checking…';

  return (
    <div className="app-container">
      {/* ── LEFT: Mirror ── */}
      <main className="mirror-section">
        <header className="mirror-header">
          <div className="header-top">
            <div>
              <h1>TRY ON AI</h1>
              <p>Virtual Fitting Room — Powered by Gemini</p>
            </div>
            <div className="sponsor-badge">
              <span className="sponsor-label">Powered by</span>
              <a href="https://getstream.io" target="_blank" rel="noopener noreferrer" className="stream-logo-link">
                <StreamLogo />
              </a>
            </div>
          </div>
        </header>

        <div className="mirror-view-wrapper">
          <div className="mirror-stage">
            {/* GetStream / webcam feed — always rendered, hidden when off */}
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="camera-feed mirrored"
              style={{ display: isMirrorOn && !showResult ? 'block' : 'none' }}
            />

            {/* Try-on result */}
            {showResult && resultUrl && (
              <img
                src={resultUrl}
                alt="Try-on result"
                className="camera-feed"
                style={{ pointerEvents: 'none' }}
                onError={() => { setCameraError('Could not load result image.'); setResultUrl(''); setShowResult(false); }}
              />
            )}

            {/* Placeholder */}
            {!isMirrorOn && !showResult && (
              <div className="camera-placeholder">
                <span style={{ fontSize: '3rem' }}>🪞</span>
                <p>Start the mirror to see yourself</p>
              </div>
            )}
          </div>

          <div className="mirror-overlay">
            <div className="overlay-badge">
              <div className="badge-pulse"></div>
              <span>
                {showResult ? 'RESULT READY' : isMirrorOn ? 'MIRROR ACTIVE' : 'STANDBY'}
              </span>
            </div>

            <div className="status-badges-row">
              {streamLabel && (
                <div className={`backend-health-badge ${streamBadgeClass}`}>
                  <span>{streamLabel}</span>
                </div>
              )}
              <div className={`backend-health-badge ${backendStatus === 'online' ? 'online' : backendStatus === 'offline' ? 'error' : 'degraded'}`}>
                <span>{backendLabel}</span>
              </div>
            </div>

            {isMirrorOn && !showResult && <div className="scan-line"></div>}

            <div className="mirror-bottom-dock">
              <div className="mirror-controls">
                <button className="btn" onClick={toggleMirror}>
                  {isMirrorOn ? 'Stop Mirror' : 'Start Mirror'}
                </button>

                <button className="btn" onClick={handleTakePhoto} disabled={!isMirrorOn || showResult}>
                  Take Photo
                </button>

                <button
                  className={`btn btn-primary${!canGenerate ? ' disabled' : ''}`}
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                >
                  {isGenerating ? 'Generating…' : 'Generate Try-On'}
                </button>

                {showResult && (
                  <>
                    <button className="btn btn-save" onClick={handleSavePhoto}>
                      💾 Save Photo
                    </button>
                    <button className="btn" onClick={() => { setShowResult(false); setResultUrl(''); setBasePhotoUrl(''); setStatus('Mirror ready. Take a new photo to try on another outfit.'); }}>
                      Try Again
                    </button>
                  </>
                )}
              </div>

              <p className="generation-status">{status}</p>
              {cameraError && <p className="camera-error">{cameraError}</p>}
            </div>
          </div>
        </div>

        {/* Base photo strip — shows the captured photo while mirror is on */}
        {basePhotoUrl && isMirrorOn && (
          <div className="pose-strip">
            <p className="pose-strip-label">Your photo</p>
            <img
              src={basePhotoUrl}
              alt="Base photo"
              className="pose-strip-thumb pose-strip-thumb--clickable"
              onClick={() => setPhotoPreviewOpen(true)}
            />
            <button className="pose-strip-retake" onClick={handleTakePhoto}>Retake</button>
          </div>
        )}

        {photoPreviewOpen && basePhotoUrl && (
          <div className="photo-lightbox" onClick={() => setPhotoPreviewOpen(false)}>
            <div className="photo-lightbox-inner" onClick={(e) => e.stopPropagation()}>
              <button className="photo-lightbox-close" onClick={() => setPhotoPreviewOpen(false)}>✕</button>
              <img src={basePhotoUrl} alt="Your photo preview" className="photo-lightbox-img" />
            </div>
          </div>
        )}

        {/* Hidden file input for outfit */}
        <input ref={outfitInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleOutfitUpload} />
      </main>

      {/* ── RIGHT: Sidebar ── */}
      <aside className="sidebar">
        <div className="panel-content">

          {/* Step indicators */}
          <div className="steps-row">
            <div className={`step ${basePhotoUrl ? 'done' : isMirrorOn ? 'active' : ''}`}>
              <span className="step-num">{basePhotoUrl ? '✓' : '1'}</span>
              <span>{basePhotoUrl ? 'Photo taken' : 'Take photo'}</span>
            </div>
            <div className="step-arrow">→</div>
            <div className={`step ${activeOutfitUrl ? 'done' : ''}`}>
              <span className="step-num">{activeOutfitUrl ? '✓' : '2'}</span>
              <span>{activeOutfitUrl ? 'Outfit ready' : 'Pick outfit'}</span>
            </div>
            <div className="step-arrow">→</div>
            <div className={`step ${showResult ? 'done' : ''}`}>
              <span className="step-num">{showResult ? '✓' : '3'}</span>
              <span>{showResult ? 'Done!' : 'Generate'}</span>
            </div>
          </div>

          {/* Outfit upload */}
          <section style={{ marginTop: '24px' }}>
            <h2>Upload Outfit Photo</h2>
            <p className="section-hint">Photo of the clothing item you want to try on</p>
            <button className="btn upload-outfit-btn" onClick={() => { if (outfitInputRef.current) { outfitInputRef.current.value = ''; outfitInputRef.current.click(); } }}>
              {customOutfitUrl ? 'Change Outfit' : '+ Upload Outfit Photo'}
            </button>
            {customOutfitUrl && (
              <div className="uploaded-garment-preview">
                <img src={customOutfitUrl} alt="Your outfit" />
                <button className="clear-btn" onClick={() => { setCustomOutfitUrl(''); setSelectedPresetId(null); if (outfitInputRef.current) outfitInputRef.current.value = ''; }}>✕</button>
              </div>
            )}
          </section>

          {/* Preset catalog */}
          <section style={{ marginTop: '24px' }}>
            <h2>Or Choose from Catalog</h2>
            <div className="item-grid">
              {PRESET_GARMENTS.map((item) => (
                <button
                  key={item.id}
                  className={`item-card${selectedPresetId === item.id && !customOutfitUrl ? ' selected' : ''}`}
                  onClick={() => handlePresetSelect(item.id)}
                >
                  <div className="item-image-wrapper">
                    <img src={item.imageUrl} alt={item.name} className="item-photo" />
                  </div>
                  <div className="item-info">
                    <h3>{item.name}</h3>
                    <p>{item.category}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Generate button in sidebar when ready */}
          {canGenerate && (
            <button
              className="btn btn-primary"
              style={{ marginTop: '24px', width: '100%' }}
              onClick={handleGenerate}
            >
              {isGenerating ? 'Generating…' : '✨ Generate Try-On'}
            </button>
          )}

          {/* GetStream info card */}
          <section className="stream-info-card">
            <div className="stream-info-logo"><StreamLogo /></div>
            <p>
              {streamStatus === 'connected'
                ? 'Mirror stream and event delivery via GetStream.'
                : 'Add Stream credentials to enable real-time video streaming.'}
            </p>
            <a href="https://getstream.io" target="_blank" rel="noopener noreferrer" className="stream-cta">
              getstream.io →
            </a>
          </section>
        </div>
      </aside>
    </div>
  );
}

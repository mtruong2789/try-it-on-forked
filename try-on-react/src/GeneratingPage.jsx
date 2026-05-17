import { useEffect, useRef, useState } from 'react';
import './GeneratingPage.css';

const SIZE  = 160;
const CX    = SIZE / 2;
const CY    = SIZE / 2;
const R     = 60;
const SW    = 18;
const CIRC  = 2 * Math.PI * R; // ≈ 376.99

// Slow-phase: approaches 88 % with tau=12 s so motion is clearly visible
const SLOW_TARGET  = 88;
const SLOW_TAU_S   = 12;

// Fast-phase: exponential approach to 100 %
const FAST_TICK_MS = 16;
const FAST_BLEND   = 0.18;

export default function GeneratingPage({ resultReady, generationError, onComplete, onError }) {
  const [completing, setCompleting] = useState(false);

  // Direct DOM refs for the arc — bypasses React render cycle so animation
  // is never blocked by batching or StrictMode double-invocation
  const arcRef       = useRef(null);
  const svgRef       = useRef(null);

  const progressRef  = useRef(0);
  const startRef     = useRef(null); // initialised on first rAF tick, not at mount
  const frameRef     = useRef(null);
  const completedRef = useRef(false);
  const intervalRef  = useRef(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Write progress directly to the SVG DOM node — no React re-render needed
  const applyProgress = (p) => {
    progressRef.current = p;
    if (arcRef.current)
      arcRef.current.style.strokeDashoffset = CIRC * (1 - p / 100);
    if (svgRef.current)
      svgRef.current.setAttribute('aria-valuenow', Math.round(p));
  };

  // ── Slow phase — rAF loop ──────────────────────────────────────────────────
  useEffect(() => {
    const tick = (now) => {
      if (completedRef.current) return;
      // Set start on the very first tick so StrictMode remounts don't skew elapsed
      if (startRef.current === null) startRef.current = now;
      const elapsed = (now - startRef.current) / 1000;
      const p = SLOW_TARGET * (1 - Math.exp(-elapsed / SLOW_TAU_S));
      applyProgress(p);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frameRef.current);
      startRef.current = null; // reset so a remount starts fresh
    };
  }, []);

  // ── Fast phase — fires when result is ready ────────────────────────────────
  useEffect(() => {
    if (!resultReady || completedRef.current) return;
    completedRef.current = true;
    cancelAnimationFrame(frameRef.current);
    setCompleting(true);

    intervalRef.current = setInterval(() => {
      const next = progressRef.current + (100 - progressRef.current) * FAST_BLEND;
      if (100 - next < 0.3) {
        clearInterval(intervalRef.current);
        applyProgress(100);
        setTimeout(() => onCompleteRef.current(), 380);
      } else {
        applyProgress(next);
      }
    }, FAST_TICK_MS);

    return () => clearInterval(intervalRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultReady]);

  // ── Error state ────────────────────────────────────────────────────────────
  if (generationError) {
    return (
      <div className="gen-overlay">
        <div className="gen-center">
          <p className="gen-error-icon">✕</p>
          <p className="gen-label gen-label-error">Generation failed</p>
          <p className="gen-error-msg">{generationError}</p>
          <button className="gen-cancel-btn gen-retry-btn" onClick={onError}>
            ← Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gen-overlay">
      <div className="gen-center">

        <svg
          ref={svgRef}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="gen-svg"
          aria-label="Generating"
          role="progressbar"
          aria-valuenow={0}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <circle
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke="#374151"
            strokeWidth={SW}
          />
          <circle
            ref={arcRef}
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke="#e7e6fa"
            strokeWidth={SW}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC}
            transform={`rotate(-90 ${CX} ${CY})`}
            className={`gen-arc${completing ? ' completing' : ''}`}
          />
        </svg>

        <p className="gen-label">Generating…</p>

        <button className="gen-cancel-btn" tabIndex={0} aria-label="Cancel">
          CANCEL
        </button>

      </div>
    </div>
  );
}

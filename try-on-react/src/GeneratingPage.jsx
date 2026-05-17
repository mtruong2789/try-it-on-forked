import { useEffect, useRef, useState } from 'react';
import './GeneratingPage.css';

// SVG donut constants
const SIZE  = 160;
const CX    = SIZE / 2;
const CY    = SIZE / 2;
const R     = 60;
const SW    = 18;
const CIRC  = 2 * Math.PI * R; // ≈ 376.99

// Slow-phase asymptote: approaches this % over ~35 s
const SLOW_TARGET   = 88;
const SLOW_TAU_S    = 35;

// Fast-phase: JS-driven interval to 100 %
const FAST_TICK_MS  = 16;
const FAST_BLEND    = 0.22;   // fraction of remaining distance per tick (exponential decay)

export default function GeneratingPage({ resultReady, generationError, onComplete, onError }) {
  const [progress,   setProgress]   = useState(0);
  const [completing, setCompleting] = useState(false);

  const progressRef    = useRef(0);
  const startRef       = useRef(performance.now());
  const frameRef       = useRef(null);
  const completedRef   = useRef(false);
  const intervalRef    = useRef(null);
  const onCompleteRef  = useRef(onComplete);
  onCompleteRef.current = onComplete; // keep ref fresh without re-subscribing

  // ── Slow phase — rAF loop, asymptotic approach to SLOW_TARGET ────────────
  useEffect(() => {
    const tick = () => {
      if (completedRef.current) return;
      const elapsed = (performance.now() - startRef.current) / 1000;
      const p = SLOW_TARGET * (1 - Math.exp(-elapsed / SLOW_TAU_S));
      progressRef.current = p;
      setProgress(p);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  // ── Fast phase — fires when Gemini result arrives ─────────────────────────
  useEffect(() => {
    if (!resultReady || completedRef.current) return;
    completedRef.current = true;
    cancelAnimationFrame(frameRef.current);
    setCompleting(true);

    // Exponential approach to 100 using a fixed-rate interval
    intervalRef.current = setInterval(() => {
      const current = progressRef.current;
      const next    = current + (100 - current) * FAST_BLEND;
      progressRef.current = next;
      setProgress(next);

      if (100 - next < 0.25) {
        clearInterval(intervalRef.current);
        setProgress(100);
        progressRef.current = 100;
        setTimeout(() => onCompleteRef.current(), 380);
      }
    }, FAST_TICK_MS);

    return () => clearInterval(intervalRef.current);
  // onComplete intentionally excluded — read via ref to avoid killing the interval on re-renders
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultReady]);

  const offset = CIRC * (1 - progress / 100);

  // ── Error state — generation failed ──────────────────────────────────────
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

        {/* ── Donut progress ring ────────────────────────────────────────── */}
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="gen-svg"
          aria-label={`Generating, ${Math.round(progress)} percent`}
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {/* Dark-gray background track */}
          <circle
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke="#374151"
            strokeWidth={SW}
          />
          {/* #e7e6fa progress arc, starts at 12 o'clock */}
          <circle
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke="#e7e6fa"
            strokeWidth={SW}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${CX} ${CY})`}
            className={`gen-arc${completing ? ' completing' : ''}`}
          />
        </svg>

        {/* "Generating…" — Megrim, slightly smaller than Welcome / Pose */}
        <p className="gen-label">Generating…</p>

        {/* CANCEL — cosmetic only */}
        <button className="gen-cancel-btn" tabIndex={0} aria-label="Cancel">
          CANCEL
        </button>

      </div>
    </div>
  );
}

import './ResultPage.css';

export default function ResultPage({ resultUrl, onBrowse, onHome, onReady }) {
  return (
    <div className="result-overlay">

      {/* Generated image fills the whole screen */}
      {resultUrl ? (
        <img src={resultUrl} alt="Your try-on result" className="result-bg-img" />
      ) : (
        <div className="result-no-image" />
      )}

      {/* ── Left button column ─────────────────────────────────────────────────── */}
      <div className="result-btns result-btns-left">
        <button className="result-btn result-btn-action" onClick={() => {}}>
          Change Size
        </button>
        <button className="result-btn result-btn-action" onClick={() => {}}>
          Change Color
        </button>
        <button className="result-btn result-btn-smart" tabIndex={-1} aria-disabled="true">
          ✨ Smart Recc
        </button>
      </div>

      {/* ── Right button column ────────────────────────────────────────────────── */}
      <div className="result-btns result-btns-right">
        <button className="result-btn result-btn-action" onClick={onBrowse}>
          Try Again
        </button>
        <button className="result-btn result-btn-action" onClick={onHome}>
          Back to Home
        </button>
        <button className="result-btn result-btn-action" onClick={onReady}>
          Retake
        </button>
      </div>

    </div>
  );
}

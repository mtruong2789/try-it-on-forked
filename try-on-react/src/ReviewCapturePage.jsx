import './ReviewCapturePage.css';

export default function ReviewCapturePage({ photoUrl, onRetake, onTryOn }) {
  const hasPhoto = Boolean(photoUrl);

  return (
    <div className="review-overlay">
      <div className="review-panel">
        <div className="review-content">

          {/* Image 1 or error message */}
          {hasPhoto ? (
            <div className="review-img-wrap">
              <img src={photoUrl} alt="Your captured photo" className="review-img" />
            </div>
          ) : (
            <p className="review-no-photo">
              Could not capture photo. Please retake.
            </p>
          )}

          {/* Action buttons */}
          <div className="review-actions">
            <button className="review-retake-btn" onClick={onRetake}>
              Retake
            </button>
            <button
              className={`review-tryon-btn${!hasPhoto ? ' disabled' : ''}`}
              onClick={hasPhoto ? onTryOn : undefined}
              disabled={!hasPhoto}
              aria-disabled={!hasPhoto}
            >
              Try On
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import './ItemDetailPage.css';

const COLORS = [
  { id: 'red',    label: 'red',    hex: '#ef4444' },
  { id: 'yellow', label: 'yellow', hex: '#eab308' },
  { id: 'blue',   label: 'blue',   hex: '#3b82f6' },
];
const SIZES = ['S', 'M', 'L', 'XL'];
const FITS  = ['Regular', 'Tall', 'Petite'];

const BackArrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

// ── Associate popup ────────────────────────────────────────────────────────────
function AssociatePopup({ onClose }) {
  return (
    <div className="assoc-overlay">
      <div className="assoc-card">
        <p className="assoc-msg">An Associate will be with you shortly</p>
        <button className="assoc-ok-btn" onClick={onClose}>Ok</button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ItemDetailPage({ product, onBack, onTryOn }) {
  const [selectedColor, setSelectedColor] = useState(null);
  const [selectedSize,  setSelectedSize]  = useState(null);
  const [selectedFit,   setSelectedFit]   = useState(null);
  const [showAssoc,     setShowAssoc]     = useState(false);

  const toggle = (val, selected, setter) =>
    setter(selected === val ? null : val);

  return (
    <div className="item-overlay">
      <div className="item-panel">

        {/* ── Top bar — same frame as Browse, back button only ─────────────── */}
        <div className="item-topbar">
          <button className="item-back-btn" onClick={onBack} aria-label="Back">
            <BackArrow />
          </button>
        </div>

        {/* ── Content ───────────────────────────────────────────────────────── */}
        <div className="item-content">

          {/* Error state — no Image 2 */}
          {!product?.imageUrl ? (
            <p className="item-no-image">No item selected. Please go back and choose a product.</p>
          ) : (
            <>
              {/* Product image — large */}
              <div className="item-img-wrap">
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="item-img"
                />
              </div>

              {/* Product name */}
              <p className="item-name">{product.name}</p>

              {/* ── Color ─────────────────────────────────────────────────── */}
              <div className="item-option-block">
                <p className="item-option-label">
                  <span className="item-option-key">Color:</span>
                  {selectedColor && (
                    <span className="item-option-val"> {selectedColor.label}</span>
                  )}
                </p>
                <div className="item-color-row">
                  {COLORS.map(c => (
                    <button
                      key={c.id}
                      className={`item-color-circle${selectedColor?.id === c.id ? ' selected' : ''}`}
                      style={{ '--swatch': c.hex }}
                      onClick={() => toggle(c, selectedColor, setSelectedColor)}
                      aria-label={c.label}
                    />
                  ))}
                </div>
              </div>

              {/* ── Size ──────────────────────────────────────────────────── */}
              <div className="item-option-block">
                <p className="item-option-label">
                  <span className="item-option-key">Size:</span>
                </p>
                <div className="item-bubble-row">
                  {SIZES.map(s => (
                    <button
                      key={s}
                      className={`item-bubble${selectedSize === s ? ' selected' : ''}`}
                      onClick={() => toggle(s, selectedSize, setSelectedSize)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Fit ───────────────────────────────────────────────────── */}
              <div className="item-option-block">
                <p className="item-option-label">
                  <span className="item-option-key">Fit:</span>
                </p>
                <div className="item-bubble-row">
                  {FITS.map(f => (
                    <button
                      key={f}
                      className={`item-bubble${selectedFit === f ? ' selected' : ''}`}
                      onClick={() => toggle(f, selectedFit, setSelectedFit)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Action buttons ────────────────────────────────────────── */}
              <div className="item-actions">
                <button className="item-tryon-btn" onClick={onTryOn}>
                  Try On
                </button>
                <button
                  className="item-associate-btn"
                  onClick={() => setShowAssoc(true)}
                >
                  Ask Associate
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {showAssoc && <AssociatePopup onClose={() => setShowAssoc(false)} />}
    </div>
  );
}

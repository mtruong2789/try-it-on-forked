import { useState, useRef, useEffect } from 'react';
import './BrowsePage.css';

const CATALOG = [
  { id: 'g1',  name: 'Cyberpunk Bomber',      category: 'Outerwear',   price: '$89.99',  imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600' },
  { id: 'g2',  name: 'Classic Denim Jacket',  category: 'Outerwear',   price: '$74.99',  imageUrl: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=600' },
  { id: 'g3',  name: 'Oversized Linen Shirt', category: 'Tops',        price: '$45.99',  imageUrl: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=600' },
  { id: 'g4',  name: 'Minimalist Black Tee',  category: 'Tops',        price: '$29.99',  imageUrl: 'https://images.unsplash.com/photo-1527719327859-c6ce80353573?w=600' },
  { id: 'g5',  name: 'Floral Summer Dress',   category: 'Dresses',     price: '$67.99',  imageUrl: 'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=600' },
  { id: 'g6',  name: 'Slim Chino Pants',      category: 'Bottoms',     price: '$54.99',  imageUrl: 'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=600' },
  { id: 'g7',  name: 'Cozy Knit Sweater',     category: 'Tops',        price: '$59.99',  imageUrl: 'https://images.unsplash.com/photo-1576871337622-98d48d1cf531?w=600' },
  { id: 'g8',  name: 'Leather Crossbody Bag', category: 'Accessories', price: '$119.99', imageUrl: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=600' },
  { id: 'g9',  name: 'High-Waist Joggers',    category: 'Bottoms',     price: '$49.99',  imageUrl: 'https://images.unsplash.com/photo-1594381898411-846e7d193883?w=600' },
];

const FILTER_OPTIONS = ['Mens', 'Womens', 'Kids', 'Accessories', 'Clearance'];

const BackArrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const ChevronDown = ({ open }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    strokeLinecap="round" strokeLinejoin="round" width="14" height="14"
    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export default function BrowsePage({ onBack, onSelectProduct }) {
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef(null);

  // Close filter dropdown on outside click
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [filterOpen]);

  const filtered = query.trim()
    ? CATALOG.filter(p =>
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        p.category.toLowerCase().includes(query.toLowerCase())
      )
    : CATALOG;

  return (
    <div className="browse-overlay">
      <div className="browse-panel">

        {/* ── Top bar ── */}
        <div className="browse-topbar">
          <button className="browse-back-btn" onClick={onBack} aria-label="Back to home">
            <BackArrow />
          </button>

          <div className="browse-search">
            <span className="browse-search-icon"><SearchIcon /></span>
            <input
              type="text"
              className="browse-search-input"
              placeholder="Search…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              spellCheck={false}
            />
          </div>

          <div className="browse-filter-wrap" ref={filterRef}>
            <button
              className={`browse-filter-btn${filterOpen ? ' open' : ''}`}
              onClick={() => setFilterOpen(o => !o)}
              aria-expanded={filterOpen}
            >
              <span>Filter</span>
              <ChevronDown open={filterOpen} />
            </button>

            {filterOpen && (
              <div className="browse-filter-dropdown">
                {FILTER_OPTIONS.map(opt => (
                  <button
                    key={opt}
                    className="browse-filter-option"
                    onClick={() => setFilterOpen(false)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Product grid ── */}
        <div className="browse-content">
          {filtered.length === 0 ? (
            <p className="browse-no-results">No results found.</p>
          ) : (
            <div className="browse-product-grid">
              {filtered.map(product => (
                <button
                  key={product.id}
                  className="browse-product-card"
                  onClick={() => onSelectProduct(product)}
                >
                  <div className="browse-product-img-wrap">
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="browse-product-img"
                      loading="lazy"
                    />
                  </div>
                  <p className="browse-product-name">{product.name}</p>
                  <p className="browse-product-price">{product.price}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Pagination ── */}
        <div className="browse-pagination">
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} className={`browse-page-btn${n === 1 ? ' active' : ''}`}>
              {n}
            </button>
          ))}
        </div>

      </div>
    </div>
  );
}

// Export catalog so App.jsx can use imageUrl as Image 2
export { CATALOG };

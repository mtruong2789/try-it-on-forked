import { useEffect } from 'react';
import './CapturePage.css';

// Duration must be longer than the CSS animation so the ring is fully gone before we leave.
const FLASH_DURATION_MS = 2300;

export default function CapturePage({ onComplete }) {
  useEffect(() => {
    const id = setTimeout(onComplete, FLASH_DURATION_MS);
    return () => clearTimeout(id);
  }, [onComplete]);

  // Nothing but the flash ring — camera feed is always-on behind everything.
  return <div className="capture-flash-ring" aria-hidden="true" />;
}

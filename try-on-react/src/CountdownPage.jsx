import { useEffect, useState } from 'react';
import './CountdownPage.css';

export default function CountdownPage({ onCapture }) {
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (count <= 0) {
      onCapture();
      return;
    }
    const id = setTimeout(() => setCount(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [count, onCapture]);

  // When count hits 0 onCapture fires and parent navigates away — nothing to render
  if (count <= 0) return null;

  return (
    <div className="countdown-overlay">
      <div className="countdown-center">
        {/* key forces React to remount the element on each tick, re-triggering the animation */}
        <span className="countdown-number" key={count}>{count}</span>
        <p className="countdown-pose">P o s e !</p>
      </div>
    </div>
  );
}

import { useEffect, useRef, useCallback } from 'react';

const IDLE_EVENTS = ['mousemove', 'mousedown', 'click', 'touchstart', 'keydown', 'scroll'];

/**
 * Calls `onIdle` after `delayMs` of no user interaction.
 * Pass `active = false` to pause (e.g. while a popup is open).
 */
export function useIdleTimeout(active, delayMs, onIdle) {
  const timerRef  = useRef(null);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle; // keep ref fresh without re-subscribing events

  const reset = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onIdleRef.current(), delayMs);
  }, [delayMs]);

  useEffect(() => {
    if (!active) {
      clearTimeout(timerRef.current);
      return;
    }
    IDLE_EVENTS.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset(); // start the clock
    return () => {
      clearTimeout(timerRef.current);
      IDLE_EVENTS.forEach(e => window.removeEventListener(e, reset));
    };
  }, [active, reset]);
}

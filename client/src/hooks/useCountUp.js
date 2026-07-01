import { useEffect, useRef, useState } from 'react';

/**
 * Animates a number from its previous value to the new target.
 * Returns the current animated value.
 */
export default function useCountUp(target, duration = 550) {
  const [value,   setValue]   = useState(target);
  const prevRef   = useRef(target);
  const rafRef    = useRef(null);

  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = target;

    if (from === target) return;

    cancelAnimationFrame(rafRef.current);
    const startTime = performance.now();

    const tick = (now) => {
      const elapsed  = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased    = 1 - Math.pow(1 - progress, 3);
      setValue(from + (target - from) * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

import { useEffect, useState } from 'react';

const QUERY = '(hover: hover)';

/** True when the main input can hover (mouse, trackpad). False on a phone or iPad used by touch. Assumes a mouse where unknown. */
export const useCanHover = () => {
  const [canHover, setCanHover] = useState(() => (typeof matchMedia === 'undefined' ? true : matchMedia(QUERY).matches));
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia(QUERY);
    const update = () => setCanHover(mq.matches);
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  return canHover;
};

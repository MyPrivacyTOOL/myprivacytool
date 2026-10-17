import { useLayoutEffect, useState, type RefObject } from 'react';

/** Width of an element in px, kept current on resize and rotation. 0 until measured (and where there is no layout engine). */
export const useElementWidth = (ref: RefObject<HTMLElement>) => {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
};

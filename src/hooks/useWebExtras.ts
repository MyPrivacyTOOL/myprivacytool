// MPC-8689 pilot: runs the extra web checks once, after the scan results are on screen, and only when VITE_WEB_EXTRAS=true. In memory only.
import { useEffect, useState } from 'react';
import { collectWebExtras, webExtrasEnabled, type WebExtra } from '@/lib/webExtras';

let cached: Promise<WebExtra[]> | null = null;
export function useWebExtras(): WebExtra[] {
  const [list, setList] = useState<WebExtra[]>([]);
  useEffect(() => {
    if (!webExtrasEnabled()) return;
    let live = true;
    cached ??= collectWebExtras();
    cached.then((v) => { if (live) setList(v); });
    return () => { live = false; };
  }, []);
  return list;
}

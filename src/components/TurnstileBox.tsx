import { useEffect, useRef } from "react";
import { loadTurnstile, type TurnstileApi } from "@/lib/turnstile";

interface TurnstileBoxProps {
  sitekey: string;
  onToken: (token: string) => void;
  /** Called with true once the widget is on the page and false when it is removed, so the form knows whether to wait for a token. */
  onRendered?: (rendered: boolean) => void;
  /** Change this number to reset the widget (a token is single use). */
  resetSignal?: number;
}

/** MPC-8430: Cloudflare Turnstile widget ("interaction-only": shows nothing unless Cloudflare needs the visitor). If the script is blocked it renders nothing. */
export default function TurnstileBox({ sitekey, onToken, onRendered, resetSignal = 0 }: TurnstileBoxProps) {
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<TurnstileApi>();
  const widget = useRef<string>();
  const cb = useRef({ onToken, onRendered });
  cb.current = { onToken, onRendered };

  useEffect(() => {
    let cancelled = false;
    loadTurnstile().then((ts) => {
      if (cancelled || !ts || !box.current) return;
      api.current = ts;
      widget.current = ts.render(box.current, {
        sitekey,
        appearance: "interaction-only",
        callback: (token: string) => cb.current.onToken(token),
        "expired-callback": () => cb.current.onToken(""),
        "error-callback": () => cb.current.onToken(""),
      });
      cb.current.onRendered?.(true);
    });
    return () => {
      cancelled = true;
      if (widget.current) {
        api.current?.remove(widget.current);
        widget.current = undefined;
        cb.current.onRendered?.(false);
      }
    };
  }, [sitekey]);

  useEffect(() => {
    if (resetSignal && widget.current) api.current?.reset(widget.current);
  }, [resetSignal]);

  return <div ref={box} data-testid="turnstile-box" />;
}

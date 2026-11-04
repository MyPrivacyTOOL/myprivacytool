import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { friendlySubmitError } from "@/lib/formFeedback";

export type LeadStatus = "idle" | "loading" | "success" | "error";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// How long the button shows its "done" state before the visitor lands on /thank-you.
const SUCCESS_HOLD_MS = 700;

/**
 * Submit state machine shared by the lead forms: idle -> loading -> success -> redirect to /thank-you
 * (or error, staying on the form with the visitor's input intact). Double submits are ignored.
 */
export function useLeadSubmit(redirectTo: string, redirectState?: Record<string, string>) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<LeadStatus>("idle");
  const [error, setError] = useState("");
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const submit = useCallback(
    async (task: () => Promise<void>, onSuccess?: () => void) => {
      if (busy.current) return;
      busy.current = true;
      setStatus("loading");
      setError("");
      try {
        await task();
        onSuccess?.();
        setStatus("success");
        timer.current = setTimeout(
          () => navigate(redirectTo, { state: redirectState }),
          prefersReducedMotion() ? 0 : SUCCESS_HOLD_MS,
        );
      } catch (err) {
        setStatus("error");
        setError(friendlySubmitError(err));
        busy.current = false;
      }
    },
    [navigate, redirectTo, redirectState],
  );

  return { status, error, submit, setError };
}

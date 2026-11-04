import type { ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import type { LeadStatus } from "@/hooks/useLeadSubmit";

interface SubmitButtonProps {
  status: LeadStatus;
  idle: ReactNode;
  loading?: string;
  success?: string;
  className?: string;
  onClick?: () => void;
}

// Submit button with a spinner while sending and a checkmark on success (MPC-7400). Animations are
// motion-safe only; the label text always changes too, and the live region announces it to screen readers.
export default function SubmitButton({ status, idle, loading = "Sending...", success = "Done", className = "", onClick }: SubmitButtonProps) {
  const locked = status === "loading" || status === "success";
  return (
    <button
      type="submit"
      disabled={locked}
      aria-busy={status === "loading"}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover hover:text-brand-white disabled:opacity-80 text-primary-foreground text-sm font-bold py-3.5 px-6 rounded-lg transition-colors ${className}`}
    >
      {status === "loading" && (
        <>
          <Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" />
          {loading}
        </>
      )}
      {status === "success" && (
        <>
          <Check size={16} className="motion-safe:animate-scale-in" aria-hidden="true" />
          {success}
        </>
      )}
      {(status === "idle" || status === "error") && idle}
      <span role="status" aria-live="polite" className="sr-only">
        {status === "loading" ? loading : status === "success" ? success : ""}
      </span>
    </button>
  );
}

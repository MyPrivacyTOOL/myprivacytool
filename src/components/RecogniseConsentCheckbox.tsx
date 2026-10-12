import { RECOGNISE_CONSENT_LABEL } from "@/lib/saveConsent";

interface RecogniseConsentCheckboxProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** True until the save box is ticked, or while sending. */
  disabled?: boolean;
  className?: string;
}

// MPC-7494 (the open mirror): the separate, optional, unticked-by-default consent to be recognised on a later visit. It is NOT the save box
// (SaveScanConsentCheckbox) and never replaces or implies it: it can be ticked only once the save box is ticked. Ticking it is not needed for the report or the saving.
export default function RecogniseConsentCheckbox({ id, checked, onChange, disabled, className = "" }: RecogniseConsentCheckboxProps) {
  return (
    <label htmlFor={id} className={`flex w-full items-start gap-2 text-left text-xs ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} text-muted-foreground ${className}`}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 shrink-0" />
      <span>{RECOGNISE_CONSENT_LABEL}</span>
    </label>
  );
}

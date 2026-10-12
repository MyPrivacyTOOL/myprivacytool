import { SAVE_CONSENT_LABEL } from "@/lib/saveConsent";

interface SaveScanConsentCheckboxProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  /** The Scan form relies on the browser blocking submit; the modal checks the box itself and shows its own message. */
  required?: boolean;
}

// MPC-7470 (D12): the separate, unticked-by-default consent for saving the visitor's scan with their email. It is NOT the
// marketing box (ConsentCheckbox) and never replaces it. Shown only while saving is on and this browser holds a finished scan.
export default function SaveScanConsentCheckbox({ id, checked, onChange, disabled, className = "", required = true }: SaveScanConsentCheckboxProps) {
  return (
    <label htmlFor={id} className={`flex w-full items-start gap-2 text-left text-xs cursor-pointer text-muted-foreground ${className}`}>
      <input
        id={id}
        type="checkbox"
        required={required}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 shrink-0"
      />
      <span>{SAVE_CONSENT_LABEL}</span>
    </label>
  );
}

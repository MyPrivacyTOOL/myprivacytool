import { SAVE_CONSENT_LABEL } from "@/lib/saveConsent";

interface SaveScanConsentCheckboxProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  /** Off by default: the box is a free choice. Ticking it saves the scan; leaving it unticked still sends the report request. */
  required?: boolean;
}

// MPC-7470 (D12): the separate, optional, unticked-by-default consent for saving the visitor's scan with their email. It is NOT the
// marketing box (ConsentCheckbox) and never replaces it. Shown only while saving is on and this browser holds a finished scan.
export default function SaveScanConsentCheckbox({ id, checked, onChange, disabled, className = "", required = false }: SaveScanConsentCheckboxProps) {
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

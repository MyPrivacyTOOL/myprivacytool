interface ConsentCheckboxProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
  // Optional label text; the default is the scan wording. /contact passes its own (MPC-10831).
  label?: string;
}

// Explicit, unticked-by-default consent box (MPC-6971). `required` makes the browser block submit until ticked.
const DEFAULT_LABEL = "Email me my results and occasional privacy tips. I can unsubscribe at any time.";

export default function ConsentCheckbox({ id, checked, onChange, disabled, className = "", labelClassName = "text-muted-foreground", label = DEFAULT_LABEL }: ConsentCheckboxProps) {
  return (
    <label htmlFor={id} className={`flex w-full items-start gap-2 text-left text-xs cursor-pointer ${labelClassName} ${className}`}>
      <input
        id={id}
        type="checkbox"
        required
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 shrink-0"
      />
      <span>{label}</span>
    </label>
  );
}

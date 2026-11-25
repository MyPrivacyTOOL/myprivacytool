interface ConsentCheckboxProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
  // Required (MPC-11120): each form states what it really sends. There is no shared default, so a new form cannot inherit "privacy tips".
  label: string;
}

// Explicit, unticked-by-default consent box (MPC-6971). `required` makes the browser block submit until ticked.
export default function ConsentCheckbox({ id, checked, onChange, disabled, className = "", labelClassName = "text-muted-foreground", label }: ConsentCheckboxProps) {
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

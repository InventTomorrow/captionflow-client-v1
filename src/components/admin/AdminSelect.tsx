import { PremiumSelect } from '../PremiumSelect';

export interface AdminSelectOption<T extends string = string> {
  value: T;
  label: string;
}

/** Admin filters share the app's themed, keyboard accessible dropdown. */
export function AdminSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  disabled,
}: {
  value: T;
  options: ReadonlyArray<AdminSelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className={`admin-select${className ? ` ${className}` : ''}`}>
      <PremiumSelect
        className="admin-select-button"
        value={value}
        options={options}
        onChange={(next) => onChange(next as T)}
        ariaLabel={ariaLabel}
        disabled={disabled}
      />
    </div>
  );
}

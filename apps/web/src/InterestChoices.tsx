import { useState, type ReactNode } from "react";
import { toggleInterest, type InterestOption } from "./profile-interests";

/**
 * The options a folded list shows: the first `shown` ones and every chosen one, in list order; all of them when unfolded
 * or when `shown` is not set.
 */
export function visibleInterests(options: InterestOption[], value: readonly string[], shown: number | undefined, open: boolean): InterestOption[] {
  if (open || shown === undefined || options.length <= shown) return options;
  return options.filter((option, index) => index < shown || value.includes(option.id));
}

/**
 * One interest list of the survey: checkbox chips like the survey's answers, 1 to max choices; children follow the chips.
 * shown (Khảo sát nhanh, 2026-11-14): the list starts folded to that many options (plus the chosen ones), with a button
 * that shows the others, so the short survey stays short on screen.
 */
export function InterestGroup({ name, number, legend, hint, options, max, value, error, onChange, shown, children }: {
  name: string; number?: number; legend: string; hint: string; options: InterestOption[]; max: number; value: string[]; error: string;
  onChange: (value: string[]) => void; shown?: number; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const full = value.length >= max;
  const visible = visibleInterests(options, value, shown, open);
  const hidden = options.length - visible.length;
  return <fieldset className={`ps-question pi-group${error ? " ps-invalid" : ""}`} data-field={name} aria-describedby={error ? `pi-error-${name}` : undefined}>
    <legend>{number !== undefined && <span className="ps-number" aria-hidden="true">{number}</span>}<span>{legend}<span className="ps-required" aria-hidden="true">*</span></span></legend>
    <p className="pi-hint">{hint} Đã chọn {value.length}/{max}.</p>
    <div className="ps-options">{visible.map((option) => {
      const checked = value.includes(option.id);
      return <label key={option.id} className={`ps-option${!checked && full ? " pi-full" : ""}`}>
        <input type="checkbox" checked={checked} disabled={!checked && full} onChange={() => onChange(toggleInterest(value, option.id, max))} />
        <span>{option.label}</span>
      </label>;
    })}
    {hidden > 0 && <button type="button" className="pi-more" onClick={() => setOpen(true)}>+ {hidden} công nghệ khác</button>}</div>
    {error && <p className="ps-field-error" id={`pi-error-${name}`}>{error}</p>}
    {children}
  </fieldset>;
}

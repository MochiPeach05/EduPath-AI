import { toggleInterest, type InterestOption } from "./profile-interests";

/** One interest list of the survey: checkbox chips like the survey's answers, 1 to max choices. */
export function InterestGroup({ name, number, legend, hint, options, max, value, error, onChange }: {
  name: string; number?: number; legend: string; hint: string; options: InterestOption[]; max: number; value: string[]; error: string;
  onChange: (value: string[]) => void;
}) {
  const full = value.length >= max;
  return <fieldset className={`ps-question pi-group${error ? " ps-invalid" : ""}`} data-field={name} aria-describedby={error ? `pi-error-${name}` : undefined}>
    <legend>{number !== undefined && <span className="ps-number" aria-hidden="true">{number}</span>}<span>{legend}<span className="ps-required" aria-hidden="true">*</span></span></legend>
    <p className="pi-hint">{hint} Đã chọn {value.length}/{max}.</p>
    <div className="ps-options">{options.map((option) => {
      const checked = value.includes(option.id);
      return <label key={option.id} className={`ps-option${!checked && full ? " pi-full" : ""}`}>
        <input type="checkbox" checked={checked} disabled={!checked && full} onChange={() => onChange(toggleInterest(value, option.id, max))} />
        <span>{option.label}</span>
      </label>;
    })}</div>
    {error && <p className="ps-field-error" id={`pi-error-${name}`}>{error}</p>}
  </fieldset>;
}

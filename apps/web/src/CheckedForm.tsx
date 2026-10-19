import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { countWords, fieldMessage, summaryMessage, wordLimitMessage, type FieldState } from "./form-checks";

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const isField = (node: unknown): node is Field =>
  node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement;

/** The label that shows a field's message: the <label> around it, or the one pointing at its id. */
function labelOf(field: Field): HTMLLabelElement | null {
  const around = field.closest("label");
  if (around) return around;
  return field.id && field.form ? field.form.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(field.id)}"]`) : null;
}

/** The label's own words before the field ("Tên nhóm năng lực"); a checkbox takes its whole label. */
function labelText(field: Field): string {
  const named = field.dataset.label ?? field.getAttribute("aria-label");
  if (named) return named;
  const label = labelOf(field);
  if (!label) return "";
  if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) return (label.textContent ?? "").replace(/\s+/g, " ").trim();
  let text = "";
  for (const node of Array.from(label.childNodes)) {
    if (node === field || (node instanceof Element && (node.contains(field) || node.matches("input, select, textarea, small")))) break;
    text += node.textContent ?? "";
  }
  return text.replace(/\*/g, "").replace(/\s+/g, " ").trim();
}

function stateOf(field: Field): FieldState {
  const input = field instanceof HTMLInputElement ? field : null;
  const lengths = field instanceof HTMLSelectElement ? null : field;
  return {
    tag: field.tagName.toLowerCase() as FieldState["tag"],
    type: input?.type ?? "",
    required: field.required,
    value: field.value,
    label: labelText(field),
    minLength: lengths && lengths.minLength > 0 ? lengths.minLength : undefined,
    maxLength: lengths && lengths.maxLength > 0 ? lengths.maxLength : undefined,
    min: input?.min || undefined,
    max: input?.max || undefined,
    step: input?.step || undefined,
    title: field.title || undefined,
    validity: field.validity,
    validationMessage: field.validationMessage,
  };
}

/** Writes the message under the field (data-error on its label, styled in ui-controls.css) or clears it. */
function show(field: Field): string {
  const message = fieldMessage(stateOf(field));
  const label = labelOf(field);
  if (message) {
    field.setAttribute("aria-invalid", "true");
    label?.setAttribute("data-error", message);
  } else {
    field.removeAttribute("aria-invalid");
    label?.removeAttribute("data-error");
  }
  return message;
}

/**
 * A <form> that checks its fields before onSubmit runs. Fields declare their rules with the usual
 * attributes (required, maxLength, min, max, type="email", pattern) or setCustomValidity; a required
 * text of only spaces counts as empty. A refused save shows a Vietnamese message under every field
 * that needs fixing (instead of the browser's bubble), focuses the first one and announces it; each
 * message goes away as soon as its field is fixed.
 */
export function CheckedForm({ onSubmit, onInput, onChange, children, ...props }: ComponentProps<"form">) {
  const [summary, setSummary] = useState("");
  const recheck = (target: EventTarget) => {
    if (!isField(target) || target.getAttribute("aria-invalid") !== "true") return;
    show(target);
    if (!target.form?.querySelector('[aria-invalid="true"]')) setSummary("");
  };
  return <form {...props} noValidate
    onSubmit={(event) => {
      const fields = Array.from(event.currentTarget.elements).filter(isField).filter((field) => field.willValidate);
      const messages = fields.map(show);
      const first = messages.findIndex(Boolean);
      if (first >= 0) {
        event.preventDefault();
        fields[first]!.focus();
        setSummary(summaryMessage(messages));
        return;
      }
      setSummary("");
      onSubmit?.(event);
    }}
    onInput={(event) => { recheck(event.target); onInput?.(event); }}
    onChange={(event) => { recheck(event.target); onChange?.(event); }}>
    {children}
    <p className="sr-only" role="alert">{summary}</p>
  </form>;
}

type DescriptionProps = Omit<ComponentProps<"textarea">, "value"> & { label: string; value: string; maxWords: number };

/**
 * A description textarea with a word counter ("12/200 từ"). Past maxWords the counter turns red and
 * the CheckedForm around it refuses to save with "Mô tả tối đa 200 từ (hiện có 215 từ).".
 */
export function DescriptionField({ label, value, maxWords, onChange, ...textarea }: DescriptionProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const counter = useId();
  const words = countWords(value);
  const message = words > maxWords ? wordLimitMessage(label, maxWords, words) : "";
  useEffect(() => { ref.current?.setCustomValidity(message); }, [message]);
  return <label>{label}
    <textarea {...textarea} ref={ref} value={value} aria-describedby={counter} onChange={(event) => {
      // Set before the form rechecks the field on this same input event.
      const next = countWords(event.target.value);
      event.target.setCustomValidity(next > maxWords ? wordLimitMessage(label, maxWords, next) : "");
      onChange?.(event);
    }} />
    <small id={counter} className={`cm-word-count${message ? " cm-word-count-over" : ""}`}>{words.toLocaleString("vi-VN")}/{maxWords.toLocaleString("vi-VN")} từ</small>
  </label>;
}

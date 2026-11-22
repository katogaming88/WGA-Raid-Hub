import { PLAN_LABELS, type Plan } from './lineup';

// The Heroic / Mythic switch (#1688), the same one on Boss groups (which plan
// to edit) and on a Heroic into Mythic night's Boss lineup (which half to
// show). Native radios, like the lineup's Cells choice. While there are
// unsaved changes it is off, so switching never drops them.
export function PlanSwitch({
  legend,
  plans,
  value,
  onChange,
  disabled = false,
  note
}: {
  legend: string;
  plans: Plan[];
  value: Plan;
  onChange: (plan: Plan) => void;
  disabled?: boolean;
  // A word after a plan's name, e.g. "(Normal too)".
  note?: Partial<Record<Plan, string>>;
}) {
  return (
    <fieldset
      className="blg-style plan-switch"
      disabled={disabled}
      title={disabled ? 'Save or undo your changes first' : undefined}
    >
      <legend>{legend}</legend>
      {plans.map((plan) => (
        <label key={plan}>
          <input type="radio" name="lineup-plan" checked={value === plan} onChange={() => onChange(plan)} />{' '}
          {PLAN_LABELS[plan]}
          {note?.[plan] ? ` ${note[plan]}` : ''}
        </label>
      ))}
    </fieldset>
  );
}

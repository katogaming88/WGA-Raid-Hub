import { useState } from 'react';
import { WOW_REALMS } from './realms';
import { realmMatches } from './signup';

// A realm search (#1102): type to filter WOW_REALMS, pick from the list.
// mousedown (not click) on an option, same as the current site's combobox --
// it fires before the input's blur, so picking an option never races the
// blur-close below. Plain buttons in a list rather than a full ARIA combobox
// pattern (listbox/option/aria-activedescendant): fewer moving parts, and
// every option is natively focusable and operable either way.
export function RealmField({ id, value, onChange }: { id: string; value: string; onChange: (realm: string) => void }) {
  const [open, setOpen] = useState(false);
  const matches = open ? realmMatches(WOW_REALMS, value) : [];

  return (
    <div className="realm-combobox">
      <input
        type="text"
        id={id}
        className="input"
        autoComplete="off"
        placeholder="Type to search…"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {matches.length > 0 && (
        <ul className="realm-dropdown">
          {matches.map((r) => (
            <li key={r}>
              <button type="button" onMouseDown={() => onChange(r)}>
                {r}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

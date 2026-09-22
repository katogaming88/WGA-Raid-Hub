import { useEffect, useState, type KeyboardEvent } from 'react';
import { WOW_REALMS } from './realms';
import { realmOptions } from './signup';

// A realm combobox (#1102, Kat 2026-09-22): click it and it browses like a
// plain dropdown (every realm, arrow keys to move, Enter to pick); type and
// it filters to a substring match, same keys. A div-based listbox, not
// ul/li -- this repo's lint refuses an interactive role on a native list
// element, and a div carries no implicit role to conflict with one.
export function RealmField({ id, value, onChange }: { id: string; value: string; onChange: (realm: string) => void }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const options = realmOptions(WOW_REALMS, value);
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-option-${i}`;

  // Keeps the highlighted option in view: with 249 realms, arrowing past the
  // scroll window's edge would otherwise move the highlight somewhere the
  // raider can't see (Kat, 2026-09-22).
  useEffect(() => {
    if (activeIndex < 0) return;
    // Optional chained: jsdom (the unit test environment) has no scrollIntoView.
    document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [id, activeIndex]);

  const openList = () => setOpen(true);
  const close = () => {
    setOpen(false);
    setActiveIndex(-1);
  };
  const choose = (realm: string) => {
    onChange(realm);
    close();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(0);
      } else {
        setActiveIndex((i) => Math.min(i + 1, options.length - 1));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(options.length - 1);
      } else {
        setActiveIndex((i) => Math.max(i - 1, 0));
      }
    } else if (e.key === 'Home' && open) {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End' && open) {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === 'Enter') {
      if (open && activeIndex >= 0 && options[activeIndex]) {
        e.preventDefault();
        choose(options[activeIndex]);
      }
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close();
    }
  };

  return (
    <div className="realm-combobox">
      <input
        type="text"
        id={id}
        className="input"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          openList();
        }}
        onClick={openList}
        onFocus={openList}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(close, 150)}
      />
      {open && options.length > 0 && (
        <div id={listId} role="listbox" aria-label="Realms" className="realm-dropdown">
          {options.map((r, i) => (
            <div
              key={r}
              id={optionId(i)}
              role="option"
              // Never in the tab order: focus stays on the input the whole
              // time, and aria-activedescendant (above) is how the highlight
              // reaches assistive tech. -1 only satisfies the lint rule that
              // an interactive role needs to be focusable.
              tabIndex={-1}
              aria-selected={i === activeIndex}
              className={i === activeIndex ? 'realm-option realm-option-active' : 'realm-option'}
              onMouseDown={() => choose(r)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {r}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

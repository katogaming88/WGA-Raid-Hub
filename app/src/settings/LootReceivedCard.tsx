import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Menu';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import {
  COUNTS_AS,
  draftFromSeen,
  GROUP_NAMES,
  moveItem,
  timesUsed,
  todaysCountsAs,
  unlistedResponses,
  type CountsAs,
  type ResponseButton,
  type ResponseList,
  type SeenResponse
} from './lootResponses';
import { useSaveLootResponses, type LootResponses } from './useSettings';

// What gets counted as loot received (#1561): officers list their
// RCLootCouncil buttons as spelled in game, highest priority first, and say
// what each counts as. A team that never saved a list starts from the buttons
// its imports used, each counted the way it is today.
export function LootReceivedCard({ teamId, data, canEdit }: { teamId: number; data: LootResponses; canEdit: boolean }) {
  const { announce } = useStatus();
  const [initial] = useState<ResponseList>(() => data.list ?? draftFromSeen(data.seen));
  const [list, setList] = useState(initial);
  const [newGroup, setNewGroup] = useState('');
  const save = useSaveLootResponses(teamId);

  const unlisted = unlistedResponses(list, data.seen);
  const unused = GROUP_NAMES.filter((name) => !list.groups.some((g) => g.name === name));
  const changed = !data.list || JSON.stringify(list) !== JSON.stringify(initial);

  const setButtons = (buttons: ResponseButton[]) => setList({ ...list, buttons });
  const setGroupButtons = (index: number, buttons: ResponseButton[]) =>
    setList({ ...list, groups: list.groups.map((g, i) => (i === index ? { ...g, buttons } : g)) });

  const onSave = () => {
    const all = [...list.buttons, ...list.groups.flatMap((g) => g.buttons)];
    if (all.some((b) => !b.text.trim())) {
      announce('error', 'Every button needs its text, as spelled in game.');
      return;
    }
    const trimmed: ResponseList = {
      buttons: list.buttons.map((b) => ({ ...b, text: b.text.trim() })),
      groups: list.groups.map((g) => ({ ...g, buttons: g.buttons.map((b) => ({ ...b, text: b.text.trim() })) }))
    };
    save.mutate(trimmed, {
      onSuccess: () => announce('success', 'Saved!'),
      onError: (error) => announce('error', errorMessage(error))
    });
  };

  return (
    <div className="card settings-card">
      <h2>What gets counted as loot received</h2>
      <dl className="loot-counts-as">
        <div>
          <dt>Main spec</dt>
          <dd>counts toward loot counts, priority and items received.</dd>
        </div>
        <div>
          <dt>Off spec</dt>
          <dd>shown on profiles and loot history, not counted.</dd>
        </div>
        <div>
          <dt>Not handed out</dt>
          <dd>logged as disenchanted or personal loot.</dd>
        </div>
        <div>
          <dt>Hidden</dt>
          <dd>not counted and not shown on profiles or loot history, for example Transmog.</dd>
        </div>
      </dl>
      {!data.list && (
        <p className="loot-note">
          Nothing saved yet. These are the buttons your imports used, counted the way they are today. Check each one,
          put them in the in-game order and save.
        </p>
      )}

      <h3 className="loot-subhead">Your buttons, highest priority first, as in game</h3>
      <ButtonRows buttons={list.buttons} seen={data.seen} canEdit={canEdit} onChange={setButtons} />
      {canEdit && (
        <div className="settings-row">
          <button type="button" className="button" onClick={() => setButtons([...list.buttons, newButton()])}>
            <Icon name="plus" /> Add a button
          </button>
          {unlisted.length > 0 && (
            <Menu
              label="Responses from your imports"
              trigger={
                <>
                  <Icon name="plus" /> Add a response from your imports
                </>
              }
              actions={unlisted.map((r) => ({
                label: `${r.text} (used ${timesText(r.count)})`,
                onSelect: () => setButtons([...list.buttons, { text: r.text, countsAs: todaysCountsAs(r.text) }])
              }))}
            />
          )}
        </div>
      )}
      {unlisted.length > 0 && (
        <p className="text-muted">
          {unlisted.length === 1
            ? "1 response from your imports isn't on your list. It counts as Hidden: not counted and not shown to raiders."
            : `${unlisted.length} responses from your imports aren't on your list. They count as Hidden: not counted and not shown to raiders.`}
        </p>
      )}

      {list.groups.map((group, index) => (
        <section key={group.name} className="loot-group" aria-labelledby={`loot-group-${index}`}>
          <div className="loot-group-head">
            <h3 id={`loot-group-${index}`} className="loot-subhead">
              Button group: {group.name}
            </h3>
            {canEdit && (
              <button
                type="button"
                className="button button-danger"
                onClick={() => setList({ ...list, groups: list.groups.filter((_, i) => i !== index) })}
              >
                Remove group
              </button>
            )}
          </div>
          <p className="text-muted">
            Buttons RCLootCouncil shows only for this kind of item, highest priority first. When exporting from
            RCLootCouncil, tick every normal button in its filter: a group button only comes along with the normal
            button in the same spot, so unticking one leaves those awards out.
          </p>
          <ButtonRows
            buttons={group.buttons}
            seen={data.seen}
            canEdit={canEdit}
            onChange={(buttons) => setGroupButtons(index, buttons)}
          />
          {canEdit && (
            <div className="settings-row">
              <button
                type="button"
                className="button"
                onClick={() => setGroupButtons(index, [...group.buttons, newButton()])}
              >
                <Icon name="plus" /> Add a button to {group.name}
              </button>
            </div>
          )}
        </section>
      ))}

      {canEdit && unused.length > 0 && (
        <div className="settings-row">
          <label htmlFor="loot-new-group">Add a button group</label>
          <select id="loot-new-group" className="select" value={newGroup} onChange={(e) => setNewGroup(e.target.value)}>
            <option value="">Choose a kind of item</option>
            {unused.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button"
            disabled={!newGroup}
            onClick={() => {
              setList({ ...list, groups: [...list.groups, { name: newGroup, buttons: [] }] });
              setNewGroup('');
            }}
          >
            Add group
          </button>
        </div>
      )}

      <dl className="loot-rows">
        <div className="loot-row">
          <dt>Personal loot, Disenchant</dt>
          <dd>Not handed out</dd>
        </div>
      </dl>
      <p className="text-muted">RCLootCouncil records these on its own; they are not buttons.</p>

      {canEdit && (
        <div className="settings-row">
          <button
            type="button"
            className="button button-primary"
            onClick={onSave}
            disabled={save.isPending || !changed}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

const newButton = (): ResponseButton => ({ text: '', countsAs: 'main' });

const timesText = (count: number) => (count === 1 ? 'once' : `${count} times`);

function ButtonRows({
  buttons,
  seen,
  canEdit,
  onChange
}: {
  buttons: ResponseButton[];
  seen: SeenResponse[];
  canEdit: boolean;
  onChange: (buttons: ResponseButton[]) => void;
}) {
  if (buttons.length === 0) return <p className="text-muted">No buttons yet.</p>;
  const update = (index: number, change: Partial<ResponseButton>) =>
    onChange(buttons.map((b, i) => (i === index ? { ...b, ...change } : b)));

  return (
    <ol className="loot-buttons">
      {buttons.map((button, index) => {
        const name = button.text.trim() || `button ${index + 1}`;
        const used = timesUsed(seen, button.text);
        return (
          <li key={index} className="loot-button">
            <span className="loot-button-pos" aria-hidden="true">
              {index + 1}
            </span>
            <input
              type="text"
              className="input loot-button-text"
              aria-label={`Button ${index + 1} text`}
              value={button.text}
              disabled={!canEdit}
              maxLength={100}
              onChange={(e) => update(index, { text: e.target.value })}
            />
            <span className="text-muted loot-button-used">{used ? `used ${timesText(used)}` : 'not used yet'}</span>
            <select
              className="select"
              aria-label={`${name} counts as`}
              value={button.countsAs}
              disabled={!canEdit}
              onChange={(e) => update(index, { countsAs: e.target.value as CountsAs })}
            >
              {COUNTS_AS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {canEdit && (
              <span className="loot-button-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${name} up`}
                  disabled={index === 0}
                  onClick={() => onChange(moveItem(buttons, index, -1))}
                >
                  <Icon name="chevronUp" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${name} down`}
                  disabled={index === buttons.length - 1}
                  onClick={() => onChange(moveItem(buttons, index, 1))}
                >
                  <Icon name="chevronDown" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${name}`}
                  onClick={() => onChange(buttons.filter((_, i) => i !== index))}
                >
                  <Icon name="close" />
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

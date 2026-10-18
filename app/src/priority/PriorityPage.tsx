import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAccess, can } from '../auth/access';
import { useSeasons } from '../calendar/useCalendar';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { errorMessage } from '../lib/errors';
import { editorSeason } from '../profile/wishlist';
import { useCatalog, useCurrentSeason, useRaidZones, useWishlistSettings } from '../profile/useProfile';
import { classColor, type PlayerRow } from '../roster/roster';
import { useRosterPlayers } from '../roster/useRoster';
import { useProgressionSettings } from '../settings/useSettings';
import type { CatalogItem } from '../profile/lootPriority';
import {
  bossOptions,
  itemFor,
  gearReadCounts,
  gearStatus,
  MARK_LABEL,
  pairedNoun,
  priorityItems,
  rankedRows,
  sections,
  TRACK_LABEL,
  type PriorityData,
  type PriorityItem,
  unmanagedItems,
  type Track,
  type Unmanaged
} from './priority';
import { draftKey, ItemEditor, type Draft } from './ItemEditor';
import { useExportString, useGearRuns, usePriorityData, useRefreshGear, useSyncTierCounts } from './usePriority';
// The Roster's toggle buttons, shared rather than restyled.
import '../roster/roster.css';
import './priority.css';

// Loot priority (#1362): each item's saved order on one track, picked from a
// list on the left and shown on the right (Kat, 2026-10-18, mockup 2B). One
// Heroic/Mythic switch drives both the list and the RCLootCouncil string, so
// the two can never disagree (#1035).
export function PriorityPage() {
  const team = useTeam();
  const where = bothQueries(bothQueries(useCurrentSeason(team.id), useWishlistSettings(team.id)), useSeasons());
  return (
    <section className="page priority-page" aria-labelledby="page-title">
      <DataState query={where} label="the season">
        {([[current, settings], seasons]) => {
          // The season an officer pinned, else the one being raided: the
          // season every officer view is on (#1351).
          const season = editorSeason(settings.view, current);
          const seasonName = seasons.find((s) => s.code === season)?.display_name ?? season;
          return (
            <>
              <div className="page-header">
                <h1 id="page-title">Loot priority</h1>
                {seasonName && <p className="text-muted page-subtitle">{seasonName}</p>}
              </div>
              {season ? (
                <Priority teamId={team.id} season={season} seasonName={seasonName ?? season} />
              ) : (
                <div className="card placeholder">
                  <p>No season is set up yet.</p>
                </div>
              )}
            </>
          );
        }}
      </DataState>
    </section>
  );
}

function Priority({ teamId, season, seasonName }: { teamId: number; season: string; seasonName: string }) {
  const [params, setParams] = useSearchParams();
  const track: Track = params.get('track') === 'mythic' ? 'Myth' : 'Hero';
  const tab = params.get('tab') === 'unmanaged' ? 'unmanaged' : 'list';
  const picked = Number(params.get('item')) || null;
  const access = useAccess();
  const officer = can(access.data, 'actAsOfficer', teamId);
  // Unsaved orders, by item and track, kept while the officer looks around.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const withParams = (values: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(values)) {
      if (value === null) next.delete(name);
      else next.set(name, value);
    }
    return next;
  };
  const change = (values: Record<string, string | null>) => setParams(withParams(values), { replace: true });
  const linkTo = (values: Record<string, string | null>) => `?${withParams(values).toString()}`;

  const reads = bothQueries(
    bothQueries(usePriorityData(teamId, season), useCatalog()),
    bothQueries(bothQueries(useRaidZones(), useRosterPlayers(teamId)), useProgressionSettings(teamId))
  );

  return (
    <DataState query={reads} label="the priority lists">
      {([[data, catalog], [[zones, players], raids]]) => {
        const items = priorityItems(data, track, catalog, zones, season);
        const item = picked ? itemFor(picked, data, track, catalog, zones, season) : null;
        const unmanaged = unmanagedItems(data, catalog, zones, season);
        const managed = (id: number) =>
          [...data.order, ...data.empty].some((r) => r.item_id === id && r.track === track);
        const unsaved = new Set(
          Object.keys(drafts)
            .filter((k) => k.endsWith(`|${track}`))
            .map((k) => Number(k.split('|')[0]))
        );
        const setDraft = (key: string, draft: Draft | null) =>
          setDrafts((all) => {
            const next = { ...all };
            if (draft) next[key] = draft;
            else delete next[key];
            return next;
          });
        return (
          <>
            <Controls
              teamId={teamId}
              season={season}
              seasonName={seasonName}
              track={track}
              onTrack={(t) => change({ track: t === 'Myth' ? 'mythic' : null })}
              officer={officer}
              players={players}
              data={data}
            />
            <nav className="priority-tabs" aria-label="Priority views">
              <Link to={linkTo({ tab: null })} replace aria-current={tab === 'list' ? 'page' : undefined}>
                Priority list
              </Link>
              <Link
                to={linkTo({ tab: 'unmanaged' })}
                replace
                aria-current={tab === 'unmanaged' ? 'page' : undefined}
                aria-label={unmanaged.length ? `Unmanaged, ${unmanaged.length}` : undefined}
              >
                Unmanaged
                {unmanaged.length > 0 && <span className="count-badge">{unmanaged.length}</span>}
              </Link>
            </nav>
            {tab === 'unmanaged' ? (
              <UnmanagedList
                unmanaged={unmanaged}
                officer={officer}
                onSet={(id, t) =>
                  change({ tab: null, item: String(id), track: t === 'Myth' ? 'mythic' : null, suggest: '1' })
                }
              />
            ) : (
              <div className="priority-split">
                <ItemList
                  items={items}
                  bosses={bossOptions(items, raids)}
                  picked={item?.itemId ?? null}
                  players={players}
                  unsaved={unsaved}
                  onPick={(id) => change({ item: String(id), suggest: null })}
                />
                {item && officer ? (
                  <ItemEditor
                    key={draftKey(item.itemId, track)}
                    teamId={teamId}
                    season={season}
                    item={item}
                    track={track}
                    managed={managed(item.itemId)}
                    data={data}
                    players={players}
                    catalog={catalog}
                    draft={drafts[draftKey(item.itemId, track)] ?? null}
                    onDraft={(d) => setDraft(draftKey(item.itemId, track), d)}
                    autoSuggest={params.get('suggest') === '1'}
                    onAutoSuggested={() => change({ suggest: null })}
                  />
                ) : item ? (
                  <ItemPanel item={item} track={track} data={data} players={players} catalog={catalog} />
                ) : (
                  <div className="card priority-panel priority-panel-empty">
                    <h2 className="section-title">Pick an item to see its priority order</h2>
                    <p className="text-muted">
                      {TRACK_LABEL[track]} track. {items.length} {items.length === 1 ? 'item' : 'items'},{' '}
                      {items.filter((i) => i.ranked.length > 0).length} with someone ranked.
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        );
      }}
    </DataState>
  );
}

// Items with no order saved on a track (the current site's Unmanaged Items),
// grouped like the list. Set Heroic or Set Mythic opens the item with a
// suggestion to review and save.
function UnmanagedList({
  unmanaged,
  officer,
  onSet
}: {
  unmanaged: Unmanaged[];
  officer: boolean;
  onSet: (itemId: number, track: Track) => void;
}) {
  if (unmanaged.length === 0) {
    return (
      <div className="card placeholder">
        <p>Every item this season has an order on both tracks.</p>
      </div>
    );
  }
  const missing = new Map(unmanaged.map((u) => [u.item.itemId, u.missing]));
  const groups = sections(
    unmanaged.map((u) => u.item),
    { search: '', boss: '', hideEmpty: false }
  );
  return (
    <div className="priority-unmanaged">
      <p className="text-muted">
        {unmanaged.length} {unmanaged.length === 1 ? 'item has' : 'items have'} no order saved on one track or both.
      </p>
      {groups.map((g) => (
        <div key={g.label} className="priority-section">
          <h2 className="priority-section-title">{g.label}</h2>
          <ul>
            {g.items.map((i) => {
              const tracks = missing.get(i.itemId)!;
              return (
                <li key={i.itemId} className="priority-unmanaged-row">
                  <span className="priority-item-name">{i.name}</span>
                  <span className="text-muted priority-unmanaged-what">
                    {tracks.length === 2 ? 'No order on either track' : `No ${TRACK_LABEL[tracks[0]!]} order`}
                  </span>
                  {officer &&
                    tracks.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className="button"
                        aria-label={`Set ${TRACK_LABEL[t]} for ${i.name}`}
                        onClick={() => onSet(i.itemId, t)}
                      >
                        Set {TRACK_LABEL[t]}
                      </button>
                    ))}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Controls({
  teamId,
  season,
  seasonName,
  track,
  onTrack,
  officer,
  players,
  data
}: {
  teamId: number;
  season: string;
  seasonName: string;
  track: Track;
  onTrack: (track: Track) => void;
  officer: boolean;
  players: PlayerRow[];
  data: PriorityData;
}) {
  const { announce } = useStatus();
  const exported = useExportString(teamId);
  const stringId = useId();
  const pickTrack = (t: Track) => {
    // A string made for the other track must not stay on screen to be copied.
    if (t !== track) exported.reset();
    onTrack(t);
  };
  const copy = () =>
    navigator.clipboard.writeText(exported.data ?? '').then(
      () => announce('success', "Copied. Paste it into the addon's Import box in game."),
      () => announce('error', 'Could not copy. Select the string and copy it by hand.')
    );

  return (
    <div className="card priority-controls">
      <div className="priority-control" role="group" aria-label="Track">
        <span className="field-label" aria-hidden="true">
          Track
        </span>
        <div className="role-filter">
          {(['Hero', 'Myth'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className="role-filter-option"
              aria-pressed={track === t}
              onClick={() => pickTrack(t)}
            >
              {TRACK_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="priority-control priority-export">
        <span className="field-label">RCLootCouncil</span>
        <button
          type="button"
          className="button button-primary"
          disabled={exported.isPending}
          onClick={() =>
            exported.mutate({ season, track }, { onError: (error) => announce('error', errorMessage(error)) })
          }
        >
          {exported.isPending ? 'Generating…' : `Generate ${TRACK_LABEL[track]} string`}
        </button>
        {exported.data && (
          <>
            <label className="visually-hidden" htmlFor={stringId}>
              RCLootCouncil string, {TRACK_LABEL[track]}
            </label>
            <input id={stringId} className="input priority-string" readOnly value={exported.data} />
            <button type="button" className="button" onClick={() => void copy()}>
              Copy
            </button>
          </>
        )}
      </div>

      {officer && <GearControls teamId={teamId} seasonName={seasonName} players={players} data={data} />}
    </div>
  );
}

function GearControls({
  teamId,
  seasonName,
  players,
  data
}: {
  teamId: number;
  seasonName: string;
  players: PlayerRow[];
  data: PriorityData;
}) {
  const { announce } = useStatus();
  const runs = useGearRuns();
  const refresh = useRefreshGear(teamId);
  const tiers = useSyncTierCounts(teamId);
  const [progress, setProgress] = useState<string | null>(null);
  const status = runs.data ? gearStatus(runs.data.cron, runs.data.byHand) : null;

  const syncTiers = () => {
    // With no tier tokens for the season every count would come out 0, and
    // writing that over each raider's real count is silent damage (#1108).
    if (!data.tierPieces.length) {
      announce('error', `Not synced: no tier tokens are set up for ${seasonName} yet.`);
      return;
    }
    tiers.mutate(
      { players, pieces: data.tierPieces, onProgress: (done, total) => setProgress(`Syncing ${done} of ${total}…`) },
      {
        onSuccess: ({ synced, skipped }) =>
          announce('success', `${synced} synced${skipped ? `, ${skipped} skipped (no Raider.IO data)` : ''}.`),
        onError: (error) => announce('error', errorMessage(error)),
        onSettled: () => setProgress(null)
      }
    );
  };

  return (
    <div className="priority-control priority-gear">
      <span className="field-label">Gear</span>
      <button
        type="button"
        className="button"
        disabled={refresh.isPending}
        onClick={() =>
          refresh.mutate(undefined, {
            onSuccess: ({ synced, skipped }) => announce('success', `${gearReadCounts(synced, skipped)}.`),
            onError: (error) => announce('error', errorMessage(error))
          })
        }
      >
        {refresh.isPending ? 'Refreshing…' : 'Refresh equipped gear'}
      </button>
      <button type="button" className="button" disabled={tiers.isPending} onClick={syncTiers}>
        {progress ?? 'Sync tier counts'}
      </button>
      <span className={status?.warn ? 'priority-gear-status warn' : 'priority-gear-status text-muted'}>
        {runs.isError ? 'Could not load the last morning read.' : status?.text}
      </span>
    </div>
  );
}

function ItemList({
  items,
  bosses,
  picked,
  players,
  unsaved,
  onPick
}: {
  items: PriorityItem[];
  bosses: string[];
  picked: number | null;
  players: PlayerRow[];
  unsaved: ReadonlySet<number>;
  onPick: (id: number) => void;
}) {
  const [search, setSearch] = useState('');
  const [boss, setBoss] = useState('');
  const [hideEmpty, setHideEmpty] = useState(false);
  const searchId = useId();
  const bossId = useId();
  const names = new Map(players.map((p) => [p.id, p.nickname?.trim() || p.name_realm.split('-')[0]!]));
  const shown = sections(items, { search, boss, hideEmpty });

  return (
    <nav className="priority-list" aria-label="Items">
      <label className="visually-hidden" htmlFor={searchId}>
        Search items
      </label>
      <input
        id={searchId}
        className="input"
        type="search"
        placeholder="Search items"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="priority-list-filters">
        <label className="visually-hidden" htmlFor={bossId}>
          Boss
        </label>
        <select id={bossId} className="select" value={boss} onChange={(e) => setBoss(e.target.value)}>
          <option value="">All bosses</option>
          {bosses.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <label className="priority-hide-empty">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Hide empty
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="text-muted">{items.length ? 'No items match.' : 'No priority lists saved for this track yet.'}</p>
      ) : (
        shown.map((s) => (
          <div key={s.label} className="priority-section">
            <h2 className="priority-section-title">{s.label}</h2>
            <ul>
              {s.items.map((i) => (
                <li key={i.itemId}>
                  <button
                    type="button"
                    className="priority-item"
                    aria-current={i.itemId === picked ? 'true' : undefined}
                    onClick={() => onPick(i.itemId)}
                  >
                    <span className="priority-item-name">{i.name}</span>
                    <span className="visually-hidden">,</span>{' '}
                    {unsaved.has(i.itemId) && <span className="priority-unsaved">Not saved</span>}
                    <span className="priority-item-count">
                      {i.ranked.length
                        ? `#1 ${names.get(i.ranked[0]!) ?? 'left the roster'} · ${i.ranked.length}`
                        : 'Nobody ranked'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </nav>
  );
}

function ItemPanel({
  item,
  track,
  data,
  players,
  catalog
}: {
  item: PriorityItem;
  track: Track;
  data: PriorityData;
  players: PlayerRow[];
  catalog: CatalogItem[];
}) {
  const rows = rankedRows(item, track, data, players, catalog);
  return (
    <section className="card priority-panel" aria-labelledby="priority-item-title">
      <div className="priority-panel-head">
        <div>
          <h2 id="priority-item-title" className="priority-panel-title">
            {item.name}
          </h2>
          <p className="text-muted priority-panel-sub">{[item.slot, item.boss].filter(Boolean).join(', ')}</p>
        </div>
        <span className={`difficulty difficulty-${track === 'Myth' ? 'mythic' : 'heroic'}`}>{TRACK_LABEL[track]}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted priority-panel-body">Nobody is ranked on this item for {TRACK_LABEL[track]}.</p>
      ) : (
        <ol className="priority-ranks" aria-label={`${item.name}, ${TRACK_LABEL[track]} order`}>
          {rows.map((r) => (
            <li key={r.playerId} className="priority-rank">
              <span className="priority-rank-num">{r.rank}</span>
              <span className="priority-rank-name" style={r.className ? { color: classColor(r.className) } : undefined}>
                {r.name}
              </span>
              <span className="priority-rank-role">{r.role ?? ''}</span>
              <span className={r.mark === 'bis' ? 'priority-mark priority-mark-bis' : 'priority-mark'}>
                {r.mark ? (MARK_LABEL[r.mark] ?? r.mark) : <span className="text-dim">No mark</span>}
              </span>
              <span className="priority-flags">
                {r.left && <span className="priority-flag">Left the roster</span>}
                {r.received && <span className="priority-flag priority-flag-good">Received {TRACK_LABEL[track]}</span>}
                {r.otherBis.length > 0 && (
                  <span className="priority-flag priority-flag-warn">
                    Has BiS {pairedNoun(item.slot)}: {r.otherBis.join(', ')}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

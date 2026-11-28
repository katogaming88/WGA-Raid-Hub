import { useId, useState } from 'react';
import { useTeam } from '../data/address';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { usePageCan } from '../auth/access';
import { errorMessage } from '../lib/errors';
import { formatInstant, isoDateShort, localTimeZoneNote } from '../lib/dates';
import { useCurrentSeason } from '../profile/useProfile';
import {
  importSeasons,
  importSummary,
  parseRclcPaste,
  SKIP_REASONS,
  UNKNOWN_SEASON,
  type SkippedRow,
  type SkipReason
} from './lootImport';
import { useImportHistory, useImportLoot, type ImportHistory } from './useLootImport';
import { useLootAccess } from '../settings/useSettings';
import '../settings/settings.css';
import './loot.css';

// The officer's Import loot page (#1363), ported from js/tabs/tab-loot-import.js:
// paste an RCLootCouncil export, then check each paste went through in the
// list of past imports.
export function ImportLootPage() {
  const team = useTeam();
  const { can } = usePageCan();
  const history = useImportHistory(team.id);
  // Settings > Loot can leave importing to the team leader (#1560); the
  // database refuses anyone else's import either way.
  const access = useLootAccess(team.id);
  const leaderOnly = access.data?.import === 'leader' && !can('leadTeam');

  return (
    <section className="page settings-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Import loot</h1>
        <p className="text-muted page-subtitle">
          In game, open RCLootCouncil, choose Export, then JSON, and copy what it shows. Paste it here. You can paste
          several nights at once: awards already on file are skipped.
        </p>
      </div>
      {can('manageLoot') && leaderOnly ? (
        <p className="card settings-card">This team leaves importing loot to the team leader.</p>
      ) : can('manageLoot') ? (
        <ImportCard teamId={team.id} />
      ) : (
        // #607: the import's duplicate check is per team, so only the team's
        // own officers import.
        <p className="card settings-card">Only this team&apos;s officers can import loot.</p>
      )}
      <DataState query={history} label="past imports">
        {(data) => <HistoryCard history={data} />}
      </DataState>
    </section>
  );
}

function ImportCard({ teamId }: { teamId: number }) {
  const { announce } = useStatus();
  const season = useCurrentSeason(teamId);
  const importLoot = useImportLoot(teamId);
  const [paste, setPaste] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  // What the last import left out, listed under the box until the next one.
  const [leftOut, setLeftOut] = useState<SkippedRow[]>([]);
  const pasteId = useId();
  const problemId = useId();
  const code = season.data?.code ?? null;

  const onImport = () => {
    const parsed = parseRclcPaste(paste);
    if ('error' in parsed) {
      setProblem(parsed.error);
      return;
    }
    setProblem(null);
    importLoot.mutate(
      // The season only files an award whose date can't be read; every other
      // award goes under the season of its own date (#1579).
      { season: code ?? '', rows: parsed.rows },
      {
        onSuccess: (counts) => {
          setPaste('');
          setLeftOut(counts.skipped ?? []);
          announce('success', importSummary(counts));
        },
        onError: (error) => announce('error', errorMessage(error))
      }
    );
  };

  return (
    <div className="card settings-card">
      <h2 className="section-title">Paste an export</h2>
      <p className="text-muted">
        Each award is filed under the season of its date. Awards from before the first season, and items that aren't
        raid gear (toys, decor, recipes, dungeon drops), are left out.
      </p>
      <label className="field-label" htmlFor={pasteId}>
        RCLootCouncil JSON
      </label>
      <textarea
        id={pasteId}
        className="textarea loot-import-paste"
        rows={8}
        spellCheck={false}
        placeholder='[{"player":"Katorri-Stormrage", ...}]'
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? problemId : undefined}
      />
      {problem && (
        <p id={problemId} className="form-error">
          {problem}
        </p>
      )}
      <div className="settings-row">
        <button type="button" className="button button-primary" onClick={onImport} disabled={importLoot.isPending}>
          {importLoot.isPending ? 'Importing...' : 'Import'}
        </button>
      </div>
      {leftOut.length > 0 && <LeftOut rows={leftOut} />}
    </div>
  );
}

// The last import's left-out awards, by reason, so the officer can see what
// didn't come in and why.
function LeftOut({ rows }: { rows: SkippedRow[] }) {
  const reasons = (Object.keys(SKIP_REASONS) as SkipReason[]).filter((r) => rows.some((row) => row.reason === r));
  return (
    <div className="loot-import-left-out">
      <h3 className="field-label">Left out of the last import</h3>
      {reasons.map((reason) => {
        const group = rows.filter((r) => r.reason === reason);
        return (
          <details key={reason}>
            <summary>
              {SKIP_REASONS[reason]} <span className="text-muted">({group.length})</span>
            </summary>
            <ul>
              {group.map((r, i) => (
                <li key={i}>
                  {r.item ?? 'Unknown item'}
                  <span className="text-muted">
                    {' – '}
                    {[r.boss, r.player.split('-')[0], isoDateShort(r.date)].filter(Boolean).join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

function HistoryCard({ history }: { history: ImportHistory }) {
  const seasons = importSeasons(history.events);
  const [picked, setPicked] = useState<string | null>(null);
  const season = picked !== null && seasons.includes(picked) ? picked : (seasons[0] ?? null);
  const events = history.events.filter((e) => e.season === season);
  const selectId = useId();
  const seasonLabel = (s: string) =>
    s === UNKNOWN_SEASON ? 'Before seasons were recorded' : (history.seasonNames[s] ?? s);

  return (
    <div className="card settings-card">
      <h2 className="section-title">Past imports</h2>
      {!seasons.length ? (
        <p className="text-muted">No loot imported yet.</p>
      ) : (
        <>
          <div className="settings-row">
            <label htmlFor={selectId}>Season</label>
            <select id={selectId} className="select" value={season ?? ''} onChange={(e) => setPicked(e.target.value)}>
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {seasonLabel(s)}
                </option>
              ))}
            </select>
          </div>
          <p className="text-muted">
            {events.length} import{events.length === 1 ? '' : 's'}. {localTimeZoneNote()}
          </p>
          <ul className="loot-import-list">
            {events.map((e) => (
              <li key={e.key}>
                <details>
                  <summary>
                    <span>{formatInstant(e.at)}</span>
                    <span>{(e.actorId && history.actorNames[e.actorId]) || 'Unknown officer'}</span>
                    <span className="text-muted">
                      {e.itemCount} item{e.itemCount === 1 ? '' : 's'}
                    </span>
                  </summary>
                  <ImportDetail byPlayer={e.byPlayer} playerNames={history.playerNames} />
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ImportDetail({
  byPlayer,
  playerNames
}: {
  byPlayer: Map<number, string[]>;
  playerNames: Record<number, string>;
}) {
  const players = [...byPlayer.entries()]
    .map(([id, items]) => ({ id, name: playerNames[id]?.split('-')[0] ?? 'Unknown', items }))
    .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
  if (!players.length) return <p className="text-muted">No breakdown by player for this import.</p>;
  return (
    <div className="loot-import-detail">
      {players.map((p) => (
        <div key={p.id}>
          <strong>{p.name}</strong> <span className="text-muted">({p.items.length})</span>
          <ul>
            {p.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

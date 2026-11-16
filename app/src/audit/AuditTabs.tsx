import { Link } from 'react-router';
import { usePageCan } from '../auth/access';
import { useAddress } from '../data/address';
import { CrestsTab, DungeonsTab, RaidsTab, VaultTab } from './AuditSeasonTabs';
import { classColor } from '../roster/roster';
import { ENCHANT_CHECKS } from '../settings/settings';
import {
  GEAR_SLOTS,
  SHORT_SLOT,
  SLOT_LABELS,
  buildAudit,
  enchantCell,
  enchantColumns,
  gemChips,
  gemColumns,
  inTabOrder,
  itemIn,
  lowGemCount,
  upgradeFigures,
  type AuditData,
  type AuditRaider,
  type GearItem
} from './audit';

export type AuditTab = 'summary' | 'gear' | 'upgrades' | 'enchants' | 'vault' | 'raids' | 'dungeons' | 'crests';

// The audit's other views (#1640, #1261): the same raiders as the Summary,
// each as a table of what the gear sync saved for every slot. They show the
// gear as of the last sync, so there is no week switch.
export function AuditTabView({
  tab,
  audit,
  now,
  seasonCode,
  seasonStart
}: {
  tab: Exclude<AuditTab, 'summary'>;
  audit: AuditData;
  now: Date;
  seasonCode: string | null;
  seasonStart: string | null;
}) {
  const raiders = inTabOrder(buildAudit(audit, 'this', now));
  const today = now.toISOString().slice(0, 10);
  return (
    <>
      {tab === 'gear' && <GearTab raiders={raiders} audit={audit} today={today} />}
      {tab === 'upgrades' && <UpgradesTab raiders={raiders} />}
      {tab === 'enchants' && <EnchantsTab raiders={raiders} audit={audit} today={today} />}
      {tab === 'vault' && <VaultTab raiders={raiders} />}
      {tab === 'raids' && <RaidsTab raiders={raiders} seasonCode={seasonCode} seasonStart={seasonStart} />}
      {tab === 'dungeons' && <DungeonsTab raiders={raiders} seasonStart={seasonStart} />}
      {tab === 'crests' && <CrestsTab raiders={raiders} seasonCode={seasonCode} />}
    </>
  );
}

export const trackClass = (track: string | null) => (track ? `ilvl-${track}` : '');

export function Name({ r }: { r: AuditRaider }) {
  return (
    <th scope="row" className="audit-name">
      <span style={{ color: classColor(r.className) }}>{r.name}</span>
      <span className="text-muted audit-spec">
        {r.spec} {r.className}
      </span>
    </th>
  );
}

// A wide table in a region that scrolls sideways only when it has to.
export function Scroller({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="card audit-table-wrap audit-tab-table" tabIndex={0} role="region" aria-label={label}>
      {children}
    </div>
  );
}

const NotRead = () => (
  <p className="text-muted audit-note">A dash means the gear sync has not read that raider&rsquo;s gear yet.</p>
);

// -- Gear ------------------------------------------------------------------------

function GearTab({ raiders, audit, today }: { raiders: AuditRaider[]; audit: AuditData; today: string }) {
  const enchantable = new Set(enchantColumns(audit.refs, today));
  return (
    <>
      <p className="text-muted audit-note">
        Every slot&rsquo;s item level, colored by its track. Marks under a level: red dot no enchant, amber square empty
        socket, grey diamond embellished (information only: some specs wear none).
      </p>
      <Scroller label="Equipped gear by slot">
        <table className="audit-table">
          <thead>
            <tr>
              <th scope="col">Raider</th>
              <th scope="col" className="col-num" title="Embellishments worn">
                Emb.
              </th>
              {GEAR_SLOTS.map((s) => (
                <th key={s} scope="col" className="col-tier" title={SLOT_LABELS[s]}>
                  {SHORT_SLOT[s]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {raiders.map((r) => (
              <tr key={r.id}>
                <Name r={r} />
                <td className="col-num">{r.check.read ? r.check.embellishments : '–'}</td>
                {GEAR_SLOTS.map((slot) => (
                  <td key={slot} className="col-tier">
                    <GearCell item={itemIn(r, slot)} read={r.check.read} enchantable={enchantable.has(slot)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Scroller>
      <NotRead />
    </>
  );
}

function GearCell({ item, read, enchantable }: { item: GearItem | null; read: boolean; enchantable: boolean }) {
  if (!item || item.item_level == null) return <span className="text-muted">–</span>;
  const noEnchant = read && enchantable && item.wow_item_id != null && item.enchantment_id == null;
  const noGem = read && (item.gem_wow_item_ids ?? []).some((g) => g == null);
  const embellished = read && item.embellished;
  return (
    <span className="gear-cell">
      <span className={`gear-ilvl ${trackClass(item.track)}`}>{item.item_level}</span>
      <span className="gear-marks">
        {noEnchant && (
          <span className="mark mark-enchant" title="No enchant">
            <span className="visually-hidden">No enchant</span>
          </span>
        )}
        {noGem && (
          <span className="mark mark-socket" title="Empty socket">
            <span className="visually-hidden">Empty socket</span>
          </span>
        )}
        {embellished && (
          <span className="mark mark-emb" title="Embellished">
            <span className="visually-hidden">Embellished</span>
          </span>
        )}
      </span>
    </span>
  );
}

// -- Upgrades ----------------------------------------------------------------------

function UpgradesTab({ raiders }: { raiders: AuditRaider[] }) {
  return (
    <>
      <p className="text-muted audit-note">
        How far each piece is upgraded on its track, and how many upgrade steps are left.
      </p>
      <Scroller label="Upgrade steps by slot">
        <table className="audit-table">
          <thead>
            <tr className="audit-sections">
              <td />
              <th scope="colgroup" colSpan={3} className="sep">
                Items by track
              </th>
              <th scope="col" className="sep">
                Steps
              </th>
              <th scope="colgroup" colSpan={GEAR_SLOTS.length} className="sep">
                Upgrade step per slot
              </th>
            </tr>
            <tr>
              <th scope="col">Raider</th>
              <th scope="col" className="col-num sep ilvl-Myth">
                Myth
              </th>
              <th scope="col" className="col-num ilvl-Hero">
                Hero
              </th>
              <th scope="col" className="col-num ilvl-Champion">
                Champ
              </th>
              <th scope="col" className="col-num sep">
                Left
              </th>
              {GEAR_SLOTS.map((s, i) => (
                <th key={s} scope="col" className={`col-tier${i === 0 ? ' sep' : ''}`} title={SLOT_LABELS[s]}>
                  {SHORT_SLOT[s]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {raiders.map((r) => {
              const f = upgradeFigures(r);
              const known = r.check.read;
              return (
                <tr key={r.id}>
                  <Name r={r} />
                  <td className="col-num sep">{known ? f.myth : '–'}</td>
                  <td className="col-num">{known ? f.hero : '–'}</td>
                  <td className="col-num">{known ? f.champion : '–'}</td>
                  <td
                    className={`col-num sep ${!known ? 'text-muted' : f.stepsLeft > 20 ? 'audit-bad' : f.stepsLeft > 8 ? 'audit-warn' : 'audit-ok'}`}
                  >
                    {known ? f.stepsLeft : '–'}
                  </td>
                  {GEAR_SLOTS.map((slot, i) => {
                    const item = itemIn(r, slot);
                    const step = known && item && item.upgrade_rank != null && item.upgrade_max != null ? item : null;
                    return (
                      <td key={slot} className={`col-tier${i === 0 ? ' sep' : ''}`}>
                        {step ? (
                          <span
                            className={`${trackClass(step.track)}${step.upgrade_rank! >= step.upgrade_max! ? ' step-done' : ''}`}
                          >
                            {step.upgrade_rank}/{step.upgrade_max}
                          </span>
                        ) : (
                          <span className="text-muted">–</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Scroller>
      <p className="text-muted audit-note">
        Each slot: upgrade step out of its track&rsquo;s steps, colored by track (Myth, Hero, Champion); bold when fully
        upgraded. Left: upgrade steps still to buy across all slots. Crafted pieces have no steps (–).
      </p>
      <NotRead />
    </>
  );
}

// -- Enchants & gems ----------------------------------------------------------------

function EnchantsTab({ raiders, audit, today }: { raiders: AuditRaider[]; audit: AuditData; today: string }) {
  const { guild, team } = useAddress();
  const { can } = usePageCan();
  const { refs } = audit;
  const enchantSlots = enchantColumns(refs, today);
  const gemSlots = gemColumns(raiders);
  const rule = ENCHANT_CHECKS.find((c) => c.id === audit.rule);
  const settings = `/g/${guild.key}/t/${team?.key}/officer/settings`;
  return (
    <>
      <div className="audit-rule">
        <span className="text-muted">Enchants and gems must be from the current expansion.</span>
        <span className="text-muted">
          Team rule: <strong className="audit-rule-name">{rule?.name}</strong> &middot; {rule?.description}
          {can('promoteAssistants') && (
            <>
              {' '}
              &middot; <Link to={settings}>change in Settings</Link>
            </>
          )}
        </span>
      </div>
      <Scroller label="Enchants and gems by slot">
        <table className="audit-table audit-enchants">
          <thead>
            <tr className="audit-sections">
              <td />
              <th scope="colgroup" colSpan={enchantSlots.length} className="sep">
                Enchants
              </th>
              <th scope="colgroup" colSpan={gemSlots.length} className="sep">
                Gems
              </th>
              <th scope="colgroup" colSpan={3} className="sep">
                Totals
              </th>
            </tr>
            <tr>
              <th scope="col">Raider</th>
              {enchantSlots.map((s, i) => (
                <th key={s} scope="col" className={i === 0 ? 'sep' : undefined}>
                  {SLOT_LABELS[s]}
                </th>
              ))}
              {gemSlots.map((s, i) => (
                <th key={s} scope="col" className={i === 0 ? 'sep' : undefined}>
                  {SLOT_LABELS[s]}
                </th>
              ))}
              <th scope="col" className="sep">
                Empty
              </th>
              <th scope="col">Low quality</th>
              <th scope="col" title="Wearing at least one epic gem">
                Epic gem
              </th>
            </tr>
          </thead>
          <tbody>
            {raiders.map((r) => {
              const c = r.check;
              const empty = c.sockets - c.filledSockets;
              const low = lowGemCount(r, refs);
              return (
                <tr key={r.id}>
                  <Name r={r} />
                  {enchantSlots.map((slot, i) => {
                    const cell = c.read ? enchantCell(itemIn(r, slot), refs) : null;
                    return (
                      <td
                        key={slot}
                        className={`enchant-cell${i === 0 ? ' sep' : ''}${cell?.kind === 'none' ? ' enchant-none' : ''}`}
                      >
                        {cell ? (
                          <>
                            <span className="enchant-name" title={cell.name}>
                              {cell.name}
                            </span>
                            {cell.rank && <span className="text-muted audit-sub">{cell.rank}</span>}
                          </>
                        ) : (
                          <span className="text-muted">–</span>
                        )}
                      </td>
                    );
                  })}
                  {gemSlots.map((slot, i) => {
                    const chips = c.read ? gemChips(itemIn(r, slot), refs) : [];
                    return (
                      <td key={slot} className={i === 0 ? 'sep' : undefined}>
                        {chips.length ? (
                          <span className="gem-chips">
                            {chips.map((chip, k) => (
                              <span key={k} className={`gem-chip gem-${chip.kind}`} title={chip.title}>
                                {chip.label}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="text-muted">–</span>
                        )}
                      </td>
                    );
                  })}
                  <td className={`sep ${!c.read ? 'text-muted' : empty ? 'audit-bad' : 'audit-ok'}`}>
                    {!c.read ? '–' : empty || 'None'}
                  </td>
                  <td className={!c.read ? 'text-muted' : low ? 'audit-warn' : 'audit-ok'}>
                    {!c.read ? '–' : low || 'None'}
                  </td>
                  <td className={c.noEpicGem === null ? 'text-muted' : c.noEpicGem ? 'audit-bad' : 'audit-ok'}>
                    {c.noEpicGem === null ? '–' : c.noEpicGem ? 'Missing' : 'Yes'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Scroller>
      <p className="text-muted audit-note">
        Each cell is the enchant on that slot with its rank; the slots are this season&rsquo;s. None: no enchant, fix
        before raid. Sockets are read from each item as Blizzard reports it, so a blank Head, Wrist or Waist means that
        piece has no socket (not counted against them). Gems: one chip per socket, Top the highest rank, Low a lower
        rank (information only, never an issue), Empty no gem.
      </p>
      <NotRead />
    </>
  );
}

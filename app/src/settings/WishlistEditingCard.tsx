import { useId, useState } from 'react';
import { usePageCan } from '../auth/access';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { useTeam } from '../data/address';
import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import { easternToday } from '../lib/dates';
import { errorMessage } from '../lib/errors';
import { currentSeason, visibleSeasons, type SeasonRow } from '../profile/profile';
import { useWishlistSettings } from '../profile/useProfile';
import './settings.css';

// Settings > Season > Wishlist editing (#1823): the team leader opens and
// closes wishlist editing per season. Raiders edit their own wishlist only
// while it is open (My profile > Wishlist). set_team_season() writes the
// audit row; passing only p_wishlist_open leaves signups as they are.
type WishlistSeason = SeasonRow & { hasRaid: boolean };
const useWishlistSeasons = () =>
  useSupabaseQuery<WishlistSeason[]>(['wishlist-season-options'], async (client) => {
    const [result, zones] = await Promise.all([
      client
        .from('seasons')
        .select('code, display_name, starts_at, ends_at')
        .order('starts_at', { nullsFirst: false })
        .order('position'),
      client.from('raid_zones').select('season')
    ]);
    const error = result.error ?? zones.error;
    if (error) return { data: null, error };
    const raided = new Set(((zones.data ?? []) as { season: string | null }[]).map((z) => z.season));
    return {
      data: visibleSeasons(result.data ?? [], easternToday()).map((s) => ({ ...s, hasRaid: raided.has(s.code) })),
      error: null
    };
  });

// The seasons a wishlist can be opened for: the ones whose raid has been added,
// the same list as Season view, so the priority page can always show it
// (#1928). One already open without a raid stays listed so it can be closed.
export const wishlistSeasonOptions = (seasons: WishlistSeason[], openSeasons: string[]) =>
  seasons.filter((s) => s.hasRaid || openSeasons.includes(s.code));

function useSetWishlistOpen(teamId: number) {
  return useSupabaseMutation<null, { season: string; open: boolean }>(
    async (client, { season, open }) => {
      const result = await client.rpc('set_team_season', {
        p_team_id: teamId,
        p_season_code: season,
        p_wishlist_open: open
      });
      return { data: null, error: result.error };
    },
    { key: ['set-wishlist-open', teamId], refreshes: [['wishlist-settings', teamId]] }
  );
}

export function WishlistEditingSection() {
  const team = useTeam();
  const seasons = useWishlistSeasons();
  const settings = useWishlistSettings(team.id);
  const { can } = usePageCan();
  return (
    <DataState query={seasons} label="seasons">
      {(list) => (
        <DataState query={settings} label="wishlist editing">
          {(s) => (
            <WishlistEditingCard
              teamId={team.id}
              seasons={wishlistSeasonOptions(list, s.openSeasons)}
              openSeasons={s.openSeasons}
              canEdit={can('leadTeam')}
            />
          )}
        </DataState>
      )}
    </DataState>
  );
}

function WishlistEditingCard({
  teamId,
  seasons,
  openSeasons,
  canEdit
}: {
  teamId: number;
  seasons: WishlistSeason[];
  openSeasons: string[];
  canEdit: boolean;
}) {
  const id = useId();
  const { announce } = useStatus();
  const set = useSetWishlistOpen(teamId);
  const [picked, setPicked] = useState('');
  // Opens on the season the team is in now, else the last one listed.
  const fallback = currentSeason(seasons)?.code ?? seasons[seasons.length - 1]?.code ?? '';
  const code = seasons.some((s) => s.code === picked) ? picked : fallback;
  const season = seasons.find((s) => s.code === code);
  if (!season) return null;
  const isOpen = openSeasons.includes(season.code);

  const onToggle = (open: boolean) =>
    set.mutate(
      { season: season.code, open },
      {
        onSuccess: () => announce('success', `Wishlist editing for ${season.display_name} is ${open ? 'on' : 'off'}.`),
        onError: (error) => announce('error', errorMessage(error))
      }
    );

  return (
    <div className="card settings-card signup-settings-card">
      <h2>Wishlist editing</h2>
      <p className="text-muted">Raiders can edit their own wishlist while this is on.</p>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-season`}>
          Wishlist season
        </label>
        <select
          id={`${id}-season`}
          className="input signup-settings-select"
          value={season.code}
          onChange={(e) => setPicked(e.target.value)}
        >
          {seasons.map((s) => (
            <option key={s.code} value={s.code}>
              {s.hasRaid ? s.display_name : `${s.display_name} (no raid yet)`}
            </option>
          ))}
        </select>
      </div>
      {!season.hasRaid && (
        <p className="text-muted">
          This season&rsquo;s raid hasn&rsquo;t been added yet, so wishlists saved here don&rsquo;t show on the
          priority page. Turn it off, and open it again once the raid is in.
        </p>
      )}
      {canEdit ? (
        <label>
          <input
            type="checkbox"
            checked={isOpen}
            disabled={set.isPending}
            onChange={(e) => onToggle(e.target.checked)}
          />{' '}
          Wishlist editing
        </label>
      ) : (
        <p className="text-muted">Only the team leader can turn wishlist editing on or off.</p>
      )}
    </div>
  );
}

import { DataState } from '../components/DataState';
import { useTeam } from '../data/address';
import { useSupabaseQuery } from '../data/query';

// The shell's one real read (#1101 "done when"): the team's active roster
// count, through the shared data layer, with its loading and error states.
function useActiveRosterCount(teamId: number) {
  return useSupabaseQuery<number>(['roster-count', teamId], async (client) => {
    const { count, error } = await client
      .from('players')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .is('archived_at', null);
    return error ? { data: null, error } : { data: count ?? 0, error: null };
  });
}

export function HomePage() {
  const team = useTeam();
  const rosterCount = useActiveRosterCount(team.id);

  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">Home</h1>
      <div className="card placeholder">
        <p>
          This is the new WGA Raid Hub, still being built. The <strong className="team-key">{team.name}</strong> home
          page comes later.
        </p>
        <DataState query={rosterCount} label="the roster">
          {(count) => (
            <p className="stat">
              <span className="num stat-value">{count}</span> active {count === 1 ? 'raider' : 'raiders'} on the roster
            </p>
          )}
        </DataState>
      </div>
    </section>
  );
}

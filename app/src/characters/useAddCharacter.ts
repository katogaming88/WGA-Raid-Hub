import { useSupabaseMutation } from '../data/query';

export type AddCharacter = {
  characterId: number;
  classSpecId: number;
};

// "Add character to roster" (#1463, #1464): the member puts one of their own
// saved characters on the team's roster, no officer step. add_own_character()
// queues the officers' Discord notice itself (#962).
export function useAddCharacter(teamId: number) {
  return useSupabaseMutation<number, AddCharacter>(
    async (client, add) => {
      const { data, error } = await client.rpc('add_own_character', {
        p_team_id: teamId,
        p_character_id: add.characterId,
        p_class_spec_id: add.classSpecId
      });
      if (error) return { data: null, error };
      return { data: data as number, error: null };
    },
    {
      key: ['add-character', teamId],
      refreshes: [
        ['access'],
        ['roster'],
        ['names'],
        ['profile-player'],
        ['person-of-player'],
        ['person-characters'],
        ['team-alts']
      ]
    }
  );
}

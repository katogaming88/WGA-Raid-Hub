import { useSupabaseMutation } from '../data/query';
import { notifyOfficers } from '../profile/useProfile';

export type AddCharacter = {
  characterId: number;
  classSpecId: number;
  // For the officers' Discord notice only.
  member: string;
  nameRealm: string;
  classSpec: string;
};

// "Add character to roster" (#1463, #1464): the member puts one of their own
// saved characters on the team's roster, no officer step. The notice to the
// officers is best-effort; the character is on the roster either way.
export function useAddCharacter(teamId: number, teamKey: string) {
  return useSupabaseMutation<number, AddCharacter>(
    async (client, add) => {
      const { data, error } = await client.rpc('add_own_character', {
        p_team_id: teamId,
        p_character_id: add.characterId,
        p_class_spec_id: add.classSpecId
      });
      if (error) return { data: null, error };
      await notifyOfficers(client, {
        action: 'addCharacter',
        team: teamKey,
        payload: { member: add.member, nameRealm: add.nameRealm, classSpec: add.classSpec }
      });
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

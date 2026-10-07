import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Json } from '../../../js/database.types';
import type { OfficerBio } from '../guild/guild';

// team_settings.config.teamOfficerBios, per team, written by the officer
// editor on the current site (js/tabs/tab-bios.js) and by this app's
// Team officers page. Guild-wide officers come from useGuildOfficers
// (guild/useGuildHome.ts); this is the per-team list.
export function useTeamOfficers(teamId: number) {
  return useSupabaseQuery<OfficerBio[]>(['team-officers', teamId], async (client) => {
    const result = await client
      .from('team_settings')
      .select('bios:config->teamOfficerBios')
      .eq('team_id', teamId)
      .maybeSingle();
    if (result.error) return { data: null, error: result.error };
    const bios = (result.data as { bios: unknown } | null)?.bios;
    return { data: Array.isArray(bios) ? (bios as OfficerBio[]) : [], error: null };
  });
}

// Saving a list of bios (#1361). Both functions check who may save and write
// their own audit entry, so the page writes none.
export function useSaveTeamOfficers(teamId: number) {
  return useSupabaseMutation<unknown, OfficerBio[]>(
    (client, bios) => client.rpc('set_team_officer_bios', { p_team_id: teamId, p_bios: bios as unknown as Json }),
    { key: ['save-team-officers', teamId], refreshes: [['team-officers', teamId]] }
  );
}

export function useSaveGuildOfficers() {
  return useSupabaseMutation<unknown, OfficerBio[]>(
    (client, bios) => client.rpc('set_guild_officer_bios', { p_bios: bios as unknown as Json }),
    { key: ['save-guild-officers'], refreshes: [['guild-officers']] }
  );
}

// A bio photo: the upload-bio-photo function checks the caller, shrinks the
// image and stores it, and answers with its address.
export function useUploadBioPhoto() {
  return useSupabaseMutation<string, File>(
    async (client, file) => {
      const { data, error } = await client.functions.invoke('upload-bio-photo', {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': file.type }
      });
      if (error) return { data: null, error: { message: error.message || 'The upload failed.' } };
      const answer = data as { success?: boolean; url?: string; error?: string } | null;
      if (!answer?.success || !answer.url)
        return { data: null, error: { message: answer?.error || 'The upload failed.' } };
      return { data: answer.url, error: null };
    },
    { key: ['upload-bio-photo'], refreshes: [] }
  );
}

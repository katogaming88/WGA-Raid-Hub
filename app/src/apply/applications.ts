// What My applications and the after-send page say about an application
// (#1547): its status in words and the progress list. Pure functions of the
// row my_applications() returns.

import type { MyApplication } from './useApplyForm';

export const STATUS_LABELS: Record<string, string> = {
  waiting_on_officers: 'Waiting on officers',
  waiting_on_applicant: 'Waiting on you',
  on_trial: 'On trial',
  joined: 'Joined',
  declined: 'Declined',
  not_joining: 'Not joining',
  no_reply: 'Closed, no reply',
  withdrawn: 'Withdrawn'
};

export const isOpen = (app: Pick<MyApplication, 'closed_at'>) => app.closed_at === null;

// "Katorri-Stormrage - sent Nov 12, 2026"; closed ones say when too.
export function applicationFacts(app: MyApplication, date: (iso: string) => string): string {
  const sent = `${app.name_realm} \u00b7 sent ${date(app.applied_at)}`;
  return app.closed_at ? `${sent} \u00b7 closed ${date(app.closed_at)}` : sent;
}

export type Step = { label: string; note: string | null; state: 'done' | 'now' | 'later' };

// The four steps of an open application. Which one is current follows the
// status and what the database says about the ticket; a closed application
// that never joined shows only that it was sent.
export function steps(app: MyApplication): Step[] {
  const sent: Step = { label: 'Application sent', note: null, state: 'done' };
  if (!isOpen(app) && app.status !== 'joined') return [sent];

  const noServer = app.add_to_server === false;
  const ticketed = noServer || !!app.ticket_url;
  const onTrial = app.status === 'on_trial';
  const joined = app.status === 'joined';
  const chatting = isOpen(app) && !onTrial;
  return [
    sent,
    {
      label: noServer ? 'Officers told' : 'Joined the Discord, ticket opened',
      note: null,
      state: ticketed ? 'done' : 'now'
    },
    {
      label: 'Chat with the officers',
      note: 'We’ll DM you on Discord when one replies. Answer within 5 days or the ticket closes; you can always apply again.',
      state: onTrial || joined ? 'done' : ticketed && chatting ? 'now' : 'later'
    },
    {
      label: 'Trial',
      note: onTrial && app.trial_ends_on ? `Ends ${app.trial_ends_on}` : 'Usually two weeks',
      state: joined ? 'done' : onTrial ? 'now' : 'later'
    }
  ];
}

import { useId, useMemo } from 'react';
import { DataState } from '../components/DataState';
import { useAddress } from '../data/address';
import { streamDirectory, type Directory, type DirectoryStream } from './directory';
import { useGuildStreamers } from './StreamWidget';
import './streams.css';

// The Streams page (#1102): every streamer in the guild, leading with whoever
// is live. Recorded behavior is in tests/behavior/streams.js, checked against
// this page by tests/browser-app/streams.test.js.
//
// Guild home shows the live ones too, as a teaser (#1102). This is the full
// directory, and the only place an offline streamer appears.
export function StreamsPage() {
  // Every team in the guild, so a card can name its streamer's team. The
  // shell has already read them, so this costs no extra request.
  const { teams } = useAddress();
  const teamIds = useMemo(() => teams.map((t) => t.id), [teams]);
  const teamNames = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);
  const streamers = useGuildStreamers(teamIds);

  return (
    <section className="page streams-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Streams</h1>
        <p className="text-muted page-subtitle">Who streams their raids, and who’s on right now.</p>
      </div>
      <DataState query={streamers} label="the streams">
        {(rows) => <StreamDirectory directory={streamDirectory(rows, teamNames)} />}
      </DataState>
    </section>
  );
}

// The two lists. Nobody live and the "Live now" section is left out entirely
// rather than shown empty: the directory below it is still worth reading.
// Nobody at all and the page says so, in the current site's words.
function StreamDirectory({ directory }: { directory: Directory }) {
  const { live, offline } = directory;

  if (!live.length && !offline.length) return <p className="stream-empty text-muted">No streamers linked yet.</p>;

  return (
    <>
      {live.length > 0 && <LiveSection streams={live} />}
      {offline.length > 0 && <OfflineSection streams={offline} />}
    </>
  );
}

// TODO(kat): whoever is live, each in a Twitch player.
//
// Shape it like Guild home's live section (guild/GuildHomePage.tsx, LiveNow +
// LiveCard) so the two pages match: a <section> labelled by its heading, a
// <ul> of cards, and in each card an .stream-embed wrapping the iframe.
//
// The iframe's src comes from embedSrc(channel, parent) in streams.ts, and it
// needs a `title` naming the streamer, plus `allowFullScreen` and
// `loading="lazy"`. #796 also asks that "Live" be written out next to the dot,
// not colour alone -- the .stream-live and .live-dot classes in streams.css
// already do that.
//
// The heading needs an id for aria-labelledby; useId() is imported for it.
//
// The tests read the markup by class, so these are the names they expect:
// the section is .streams-live, each card is an <li>, and inside it
// .stream-name, .stream-channel (the twitch.tv link), .stream-team and
// .stream-note.
function LiveSection({ streams }: { streams: DirectoryStream[] }) {
  const titleId = useId();
  void titleId;
  void streams;
  return null;
}

// TODO(kat): everyone else, as a compact list -- no players, since they are
// not streaming anything right now.
//
// Each row wants: their name, a link to twitch.tv/<channel> (target="_blank"
// rel="noopener", and run the channel through encodeURIComponent like the live
// card does), their team, and their schedule note when they have written one.
// The tests expect .streams-offline on the section, an <li> per person, and
// the same .stream-name / .stream-channel / .stream-team / .stream-note names
// inside. All but .stream-team are already styled in streams.css.
function OfflineSection({ streams }: { streams: DirectoryStream[] }) {
  const titleId = useId();
  void titleId;
  void streams;
  return null;
}

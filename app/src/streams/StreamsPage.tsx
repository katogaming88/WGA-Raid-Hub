import { useId, useMemo } from 'react';
import { DataState } from '../components/DataState';
import { useAddress } from '../data/address';
import { streamDirectory, type Directory, type DirectoryStream } from './directory';
import { embedParent, embedSrc } from './streams';
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

// Whoever is live, each in a Twitch player. Shaped like Guild home's live
// section (guild/GuildHomePage.tsx) so the two read as the same thing, with
// the channel and team a directory needs and Guild home leaves out.
function LiveSection({ streams }: { streams: DirectoryStream[] }) {
  const titleId = useId();

  return (
    <section className="streams-live" aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">
        Live now
      </h2>
      <ul className="stream-grid">
        {streams.map((stream) => (
          <li key={stream.id} className="card stream-card">
            <div className="stream-embed">
              {/* Muted, so opening the page does not start talking (#286). */}
              <iframe
                src={embedSrc(stream.channel, embedParent())}
                title={`${stream.name}’s stream on Twitch`}
                allowFullScreen
                loading="lazy"
              />
            </div>
            <div className="stream-card-body">
              <div className="stream-card-header">
                <span className="stream-name">{stream.name}</span>
                {/* "Live" is written out, so the dot is not colour alone (#796). */}
                <span className="stream-live">
                  <span className="live-dot" aria-hidden="true" />
                  Live
                </span>
              </div>
              <a
                className="stream-channel"
                href={`https://twitch.tv/${encodeURIComponent(stream.channel)}`}
                target="_blank"
                rel="noopener"
              >
                twitch.tv/{stream.channel}
              </a>
              <span className="stream-team">{stream.team}</span>
              {stream.note && <p className="stream-note">{stream.note}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Everyone else, as a compact list: no players, since they are not streaming
// anything right now.
function OfflineSection({ streams }: { streams: DirectoryStream[] }) {
  const titleId = useId();
  return (
    <section className="streams-offline" aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">
        Also streaming
      </h2>
      <ul className="stream-directory">
        {streams.map((stream) => (
          <li key={stream.id}>
            <span className="stream-name">{stream.name}</span>
            <a
              className="stream-channel"
              href={`https://twitch.tv/${encodeURIComponent(stream.channel)}`}
              target="_blank"
              rel="noopener"
            >
              twitch.tv/{stream.channel}
            </a>
            <span className="stream-team">{stream.team}</span>
            {stream.note && <p className="stream-note">{stream.note}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

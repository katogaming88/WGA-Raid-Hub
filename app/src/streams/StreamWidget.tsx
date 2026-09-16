import { useId, useState } from 'react';
import { Icon } from '../components/Icon';
import { useSupabaseQuery } from '../data/query';
import { embedSrc, liveStreams, liveText, type Stream, type StreamerRow } from './streams';
import './streams.css';

const COLLAPSED_KEY = 'wga-stream-widget-collapsed';

// A saved choice wins. Otherwise the panel starts open, as it does today,
// except on a narrow screen, where an open panel would cover the page.
function initiallyOpen(): boolean {
  try {
    const saved = localStorage.getItem(COLLAPSED_KEY);
    if (saved === '1') return false;
    if (saved === '0') return true;
  } catch {
    // Storage can be blocked; fall through.
  }
  return !(window.matchMedia?.('(max-width: 720px)').matches ?? false);
}

// Every team's streamers, so another team's live streamer shows here too.
// A handful of rows per guild.
export function useGuildStreamers(teamIds: number[]) {
  return useSupabaseQuery<StreamerRow[]>(['streamers', teamIds], (client) =>
    client
      .from('streamers')
      .select('id, team_id, twitch_channel, schedule_note, guild_wide_opt_out, is_live, players(name_realm, nickname)')
      .in('team_id', teamIds)
      .order('id')
  );
}

// The floating live-streams panel, on every team page (#286, #1102). The
// button says who is live; the panel plays their streams, muted. A failed read
// hides the widget: it is an extra, and the page it sits on has its own
// content to show.
export function StreamWidget({ teamId, teamIds }: { teamId: number; teamIds: number[] }) {
  const streamers = useGuildStreamers(teamIds);
  const [open, setOpen] = useState(initiallyOpen);
  const panelId = useId();

  if (!streamers.isSuccess) return null;
  const live = liveStreams(streamers.data, teamId);

  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(COLLAPSED_KEY, open ? '1' : '0');
    } catch {
      // Not saved; the choice still applies for this visit.
    }
  };

  return (
    <section className="stream-widget" aria-label="Live streams">
      {open && (
        <div id={panelId} className="stream-panel card">
          {live.length ? (
            <ul className="stream-list">
              {live.map((stream) => (
                <StreamCard key={stream.id} stream={stream} />
              ))}
            </ul>
          ) : (
            <p className="stream-empty text-dim">No one is live right now.</p>
          )}
        </div>
      )}
      <button
        type="button"
        className="stream-toggle"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
      >
        {live.length ? <span className="live-dot" aria-hidden="true" /> : <Icon name="tv" size={14} />}
        <span className="stream-toggle-text">{live.length ? liveText(live.map((s) => s.name)) : 'Streams'}</span>
        <Icon name="chevronDown" size={14} />
      </button>
    </section>
  );
}

function StreamCard({ stream }: { stream: Stream }) {
  return (
    <li className="stream-card">
      <div className="stream-embed">
        <iframe
          src={embedSrc(stream.channel, window.location.hostname || 'localhost')}
          title={`${stream.name}’s stream on Twitch`}
          allowFullScreen
          loading="lazy"
        />
      </div>
      <div className="stream-card-body">
        <div className="stream-card-header">
          <span className="stream-name">{stream.name}</span>
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
        {stream.note && <p className="stream-note text-dim">{stream.note}</p>}
      </div>
    </li>
  );
}

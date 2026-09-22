import { classColor } from '../roster/roster';
import { classBadgeLabel } from './officers';
import type { BioCard } from '../guild/guild';
import './officers.css';

// Bio cards for Guild officers and Team officers (#1102): one card per
// person, every field the officer editor on the current site can set
// (js/tabs/tab-bios.js). Read-only here; editing stays on officer.html until
// the officer dashboard is rebuilt (#1103).
export function BioCards({ cards }: { cards: BioCard[] }) {
  return (
    <ul className="bio-cards">
      {cards.map((card, i) => (
        <li key={`${i}-${card.name}`} className="card bio-card">
          {card.photo ? (
            <img className="bio-photo" src={card.photo} alt="" />
          ) : (
            <span className="bio-photo bio-photo-fallback" aria-hidden="true">
              {card.initials}
            </span>
          )}
          <span className="bio-name" style={card.classKey ? { color: classColor(card.classKey) } : undefined}>
            {card.name}
            {card.pronouns && <span className="text-muted bio-pronouns"> ({card.pronouns})</span>}
          </span>
          {card.characterName && <span className="text-muted bio-charname">{card.characterName}</span>}
          {card.title && <span className="bio-title">{card.title}</span>}
          {card.classKey && (
            <span className="badge bio-class" style={{ borderColor: classColor(card.classKey) }}>
              {classBadgeLabel(card.classKey, card.spec)}
            </span>
          )}
          {card.bio && <p className="bio-text">{card.bio}</p>}
        </li>
      ))}
    </ul>
  );
}

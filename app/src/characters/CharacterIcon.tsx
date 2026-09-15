import { classColor } from '../roster/roster';
import { specIcon } from '../roster/specIcons';

// The spec's icon, or, for a character whose spec Blizzard did not say (a
// locked profile), a square in the class color with the class's first letters.
// Decorative: the class and spec are written out beside it.
export function CharacterIcon({
  className,
  spec,
  size = 28
}: {
  className: string | null;
  spec: string | null;
  size?: number;
}) {
  const icon = specIcon(className, spec);
  if (icon) {
    return <img className="character-icon" src={icon} alt="" width={size} height={size} loading="lazy" />;
  }
  const letters = (className ?? '?')
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className="character-icon character-icon-letters"
      aria-hidden="true"
      style={{ width: size, height: size, background: className ? classColor(className) : undefined }}
    >
      {letters.length > 1 ? letters : (className ?? '?').slice(0, 2).toUpperCase()}
    </span>
  );
}

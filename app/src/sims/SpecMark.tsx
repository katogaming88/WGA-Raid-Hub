import { specIcon } from '../roster/specIcons';
import './sims.css';

// Which spec a sim gain belongs to (#1916): the spec's icon, named by its alt
// text and a tooltip, or the spec's name where the hub has no icon for it.
export function SpecMark({ className, spec }: { className: string | null; spec: string }) {
  const icon = specIcon(className, spec);
  if (!icon) return <span className="sim-spec-name">{spec}</span>;
  return <img className="sim-spec-icon" src={icon} alt={spec} title={spec} width={16} height={16} loading="lazy" />;
}

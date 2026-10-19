import type { ReactNode } from 'react';
import type { ItemLinkData } from '../profile/lootPriority';
import './item-link.css';

// An item's name, linked to its Wowhead page in a new tab, with its icon when
// the catalog has one. Without a Wowhead id it is the name alone.
export function ItemLink({ link, children }: { link: ItemLinkData | null; children: ReactNode }) {
  if (!link) return <span className="item-link">{children}</span>;
  return (
    <a
      className="item-link"
      href={`https://www.wowhead.com/${link.ptr ? 'ptr/' : ''}item=${link.wowId}`}
      target="_blank"
      rel="noopener noreferrer"
      // Says where it goes, for screen readers, without adding to the visible name.
      aria-label={typeof children === 'string' ? `${children}, opens Wowhead in a new tab` : undefined}
    >
      {link.icon && (
        // Wowhead's large icon, shown small: the small one looks blurry.
        <img className="item-link-icon" src={`https://wow.zamimg.com/images/wow/icons/large/${link.icon}.jpg`} alt="" />
      )}
      {children}
    </a>
  );
}

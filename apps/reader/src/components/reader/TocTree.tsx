import type { TocItem } from '@hamesh/core';

export const TocTree = ({
  items,
  activeHref,
  onSelect,
}: {
  items: TocItem[];
  activeHref: string | null;
  onSelect: (href: string) => void;
}) => (
  <ol className="toc-list">
    {items.map((item) => (
      <li key={`${item.href}-${item.label}`}>
        <button
          type="button"
          className={item.href === activeHref ? 'toc-item is-active' : 'toc-item'}
          onClick={() => onSelect(item.href)}
        >
          {item.label}
        </button>
        {item.subitems?.length ? (
          <TocTree items={item.subitems} activeHref={activeHref} onSelect={onSelect} />
        ) : null}
      </li>
    ))}
  </ol>
);

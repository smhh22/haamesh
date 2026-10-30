import { useTranslation } from 'react-i18next';

interface ShortcutRow {
  keys: string[];
  labelKey: string;
}

interface ShortcutGroup {
  titleKey: string;
  rows: ShortcutRow[];
}

const GROUPS: ShortcutGroup[] = [
  {
    titleKey: 'shortcuts.library',
    rows: [
      { keys: ['/'], labelKey: 'shortcuts.search' },
      { keys: ['?'], labelKey: 'shortcuts.help' },
      { keys: ['Esc'], labelKey: 'shortcuts.escapeLibrary' },
    ],
  },
  {
    titleKey: 'shortcuts.reader',
    rows: [
      { keys: ['←', '→'], labelKey: 'shortcuts.pageTurn' },
      { keys: ['Space'], labelKey: 'shortcuts.pageNext' },
      { keys: ['Shift', 'Space'], labelKey: 'shortcuts.pagePrev' },
      { keys: ['+', '−'], labelKey: 'shortcuts.zoom' },
      { keys: ['Esc'], labelKey: 'shortcuts.escapeReader' },
      { keys: ['?'], labelKey: 'shortcuts.help' },
    ],
  },
];

/**
 * The keyboard shortcut map, shared by the settings page and the `?` overlay so
 * both stay in step. Keys render as key caps; labels are localized.
 */
export const ShortcutsList = () => {
  const { t } = useTranslation();

  return (
    <div className="shortcut-groups">
      {GROUPS.map((group) => (
        <section key={group.titleKey} className="shortcut-group">
          <h3>{t(group.titleKey)}</h3>
          <dl className="shortcut-list">
            {group.rows.map((row) => (
              <div key={`${row.labelKey}:${row.keys.join('+')}`} className="shortcut-row">
                <dt>
                  {row.keys.map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </dt>
                <dd>{t(row.labelKey)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
};

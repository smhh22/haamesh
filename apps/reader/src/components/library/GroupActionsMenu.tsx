import { useTranslation } from 'react-i18next';
import { OverflowMenu } from './OverflowMenu';

interface GroupActionsMenuProps {
  onRename: () => void;
  onAddBooks: () => void;
  onDelete: () => void;
}

/** Group row/card actions collapse into one menu, like category headers. */
export const GroupActionsMenu = ({ onRename, onAddBooks, onDelete }: GroupActionsMenuProps) => {
  const { t } = useTranslation();

  return (
    <OverflowMenu label={t('library.groupActions')}>
      {(close) => {
        const run = (action: () => void) => {
          close();
          action();
        };
        return (
          <>
            <button type="button" role="menuitem" onClick={() => run(onAddBooks)}>
              {t('library.groupAddBooks')}
            </button>
            <button type="button" role="menuitem" onClick={() => run(onRename)}>
              {t('library.groupRename')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              onClick={() => run(onDelete)}
            >
              {t('library.groupDelete')}
            </button>
          </>
        );
      }}
    </OverflowMenu>
  );
};

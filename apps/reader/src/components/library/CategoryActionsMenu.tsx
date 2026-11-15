import { useTranslation } from 'react-i18next';
import { OverflowMenu } from './OverflowMenu';

interface CategoryActionsMenuProps {
  onAddSubcategory: () => void;
  /** Offered when the view supports group shelves (ADR-0025). */
  onAddGroup?: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRename: () => void;
  onDelete: () => void;
}

/**
 * Category header actions collapse into one menu; the header itself stays a
 * quiet label instead of a row of five text links.
 */
export const CategoryActionsMenu = ({
  onAddSubcategory,
  onAddGroup,
  onMoveUp,
  onMoveDown,
  onRename,
  onDelete,
}: CategoryActionsMenuProps) => {
  const { t } = useTranslation();

  return (
    <OverflowMenu label={t('library.categoryActions')}>
      {(close) => {
        const run = (action: () => void) => {
          close();
          action();
        };
        return (
          <>
            <button type="button" role="menuitem" onClick={() => run(onAddSubcategory)}>
              {t('library.addSubcategory')}
            </button>
            {onAddGroup ? (
              <button type="button" role="menuitem" onClick={() => run(onAddGroup)}>
                {t('library.newGroup')}
              </button>
            ) : null}
            <button type="button" role="menuitem" onClick={() => run(onMoveUp)}>
              {t('library.moveCategoryUp')}
            </button>
            <button type="button" role="menuitem" onClick={() => run(onMoveDown)}>
              {t('library.moveCategoryDown')}
            </button>
            <button type="button" role="menuitem" onClick={() => run(onRename)}>
              {t('library.renameCategory')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              onClick={() => run(onDelete)}
            >
              {t('library.deleteCategory')}
            </button>
          </>
        );
      }}
    </OverflowMenu>
  );
};

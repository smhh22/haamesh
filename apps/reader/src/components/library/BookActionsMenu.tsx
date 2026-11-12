import { useTranslation } from 'react-i18next';
import { OverflowMenu } from './OverflowMenu';

interface BookActionsMenuProps {
  hasFile: boolean;
  downloading: boolean;
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onDownload: () => void;
}

/**
 * Secondary row actions. The primary action (Read/Listen/Watch) is a visible
 * sibling button; destructive or secondary actions stay in this menu so every
 * line does not repeat three text links.
 */
export const BookActionsMenu = ({
  hasFile,
  downloading,
  disabled,
  onEdit,
  onRemove,
  onDownload,
}: BookActionsMenuProps) => {
  const { t } = useTranslation();

  return (
    <OverflowMenu label={t('library.bookActions')} disabled={disabled}>
      {(close) => (
        <>
          {!hasFile ? (
            <button
              type="button"
              role="menuitem"
              disabled={downloading}
              onClick={() => {
                close();
                onDownload();
              }}
            >
              {downloading ? t('library.downloading') : t('library.download')}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              onEdit();
            }}
          >
            {t('library.edit')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => {
              close();
              onRemove();
            }}
          >
            {t('library.remove')}
          </button>
        </>
      )}
    </OverflowMenu>
  );
};

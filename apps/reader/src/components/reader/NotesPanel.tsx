import type { BookNoteRecord } from '@hamesh/storage';
import i18n from 'i18next';
import { useTranslation } from 'react-i18next';

interface NotesPanelProps {
  notes: BookNoteRecord[];
  editingNoteId: string | null;
  editDraft: string;
  onEditDraftChange: (draft: string) => void;
  onEdit: (note: BookNoteRecord) => void;
  onSaveEdit: (note: BookNoteRecord) => void;
  onCancelEdit: () => void;
  onDelete: (noteId: string) => void;
  onJump: (note: BookNoteRecord) => void;
  onExportMarkdown: () => void;
  onExportJson: () => void;
  onClose: () => void;
}

export const NotesPanel = ({
  notes,
  editingNoteId,
  editDraft,
  onEditDraftChange,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onJump,
  onExportMarkdown,
  onExportJson,
  onClose,
}: NotesPanelProps) => {
  const { t } = useTranslation();
  const percentFormat = new Intl.NumberFormat(i18n.language === 'fa' ? 'fa-IR' : 'en-US', {
    style: 'percent',
    maximumFractionDigits: 0,
  });
  return (
    <aside className="reader-panel notes-panel" aria-label={t('reader.notes')}>
      <div className="panel-header">
        <h2>{t('reader.notes')}</h2>
        <div className="panel-actions">
          <button type="button" className="reader-action" onClick={onExportMarkdown}>
            {t('reader.exportMarkdown')}
          </button>
          <button type="button" className="reader-action" onClick={onExportJson}>
            {t('reader.exportJson')}
          </button>
          <button type="button" className="text-button" onClick={onClose}>
            {t('reader.close')}
          </button>
        </div>
      </div>
      {notes.length === 0 ? (
        <p className="hint">{t('reader.notesEmpty')}</p>
      ) : (
        <ul className="notes-list">
          {notes.map((note) => (
            <li key={note.id} className="note-item">
              <div className="note-meta">
                {note.color ? (
                  <span className="note-color" style={{ background: note.color }} />
                ) : null}
                <span>{t(`reader.noteTypes.${note.type}`)}</span>
                <span className="note-progress">
                  {note.locator.kind === 'page'
                    ? t('reader.pageNumber', {
                        page: new Intl.NumberFormat(
                          i18n.language === 'fa' ? 'fa-IR' : 'en-US',
                        ).format(note.locator.page),
                      })
                    : percentFormat.format(note.locator.fraction)}
                </span>
              </div>
              {note.text ? (
                <blockquote className="note-text" dir="auto">
                  {note.text}
                </blockquote>
              ) : null}
              {editingNoteId === note.id ? (
                <div className="note-edit">
                  <textarea
                    value={editDraft}
                    onChange={(event) => onEditDraftChange(event.currentTarget.value)}
                    aria-label={t('reader.notePlaceholder')}
                  />
                  <div className="note-actions">
                    <button
                      type="button"
                      className="reader-action"
                      onClick={() => onSaveEdit(note)}
                    >
                      {t('reader.save')}
                    </button>
                    <button type="button" className="reader-action" onClick={() => onCancelEdit()}>
                      {t('reader.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {note.note ? (
                    <p className="note-text" dir="auto">
                      {note.note}
                    </p>
                  ) : null}
                  <div className="note-actions">
                    <button type="button" className="reader-action" onClick={() => onJump(note)}>
                      {t('reader.jump')}
                    </button>
                    <button type="button" className="reader-action" onClick={() => onEdit(note)}>
                      {t('reader.edit')}
                    </button>
                    <button
                      type="button"
                      className="reader-action"
                      onClick={() => onDelete(note.id)}
                    >
                      {t('reader.delete')}
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
};

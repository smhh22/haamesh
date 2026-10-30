import { useTranslation } from 'react-i18next';
import type { ReaderSettings } from '../../stores/readerSettingsStore';

interface SettingsPanelProps {
  settings: ReaderSettings;
  isPdf: boolean;
  onClose: () => void;
}

export const SettingsPanel = ({ settings, isPdf, onClose }: SettingsPanelProps) => {
  const { t } = useTranslation();
  const fontSize = settings.fontSize;
  return (
    <aside className="reader-panel settings-panel" aria-label={t('reader.settings')}>
      <div className="panel-header">
        <h2>{t('reader.settings')}</h2>
        <button type="button" className="text-button" onClick={onClose}>
          {t('reader.close')}
        </button>
      </div>

      {isPdf ? (
        <div className="setting-row">
          <span>{t('reader.zoom')}</span>
          <div className="setting-controls">
            <button
              type="button"
              className="reader-action"
              aria-label={t('reader.zoomOut')}
              onClick={settings.zoomOut}
            >
              −
            </button>
            <button
              type="button"
              className={
                settings.pdfZoom === 'fit-page' ? 'reader-action is-selected' : 'reader-action'
              }
              onClick={() => settings.setPdfZoom('fit-page')}
            >
              {t('reader.fitPage')}
            </button>
            <button
              type="button"
              className={
                settings.pdfZoom === 'fit-width' ? 'reader-action is-selected' : 'reader-action'
              }
              onClick={() => settings.setPdfZoom('fit-width')}
            >
              {t('reader.fitWidth')}
            </button>
            <button
              type="button"
              className="reader-action"
              aria-label={t('reader.zoomIn')}
              onClick={settings.zoomIn}
            >
              +
            </button>
          </div>
        </div>
      ) : null}
      {!isPdf ? (
        <>
          <div className="setting-row">
            <span>{t('reader.fontSize')}</span>
            <div className="setting-controls">
              <button
                type="button"
                className="reader-action"
                aria-label={t('reader.decreaseFont')}
                onClick={settings.decreaseFont}
              >
                A−
              </button>
              <span className="setting-value">{fontSize}%</span>
              <button
                type="button"
                className="reader-action"
                aria-label={t('reader.increaseFont')}
                onClick={settings.increaseFont}
              >
                A+
              </button>
            </div>
          </div>
          <div className="setting-row">
            <span>{t('reader.theme')}</span>
            <div className="setting-controls">
              {(['auto', 'light', 'sepia', 'dark'] as const).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  className={
                    settings.theme === theme ? 'reader-action is-selected' : 'reader-action'
                  }
                  onClick={() => settings.setTheme(theme)}
                >
                  {t(`reader.themes.${theme}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <span>{t('reader.justify')}</span>
            <button
              type="button"
              className={settings.justify ? 'reader-action is-selected' : 'reader-action'}
              aria-pressed={settings.justify}
              onClick={settings.toggleJustify}
            >
              {settings.justify ? t('reader.on') : t('reader.off')}
            </button>
          </div>{' '}
          <div className="setting-row">
            <span>{t('reader.flow')}</span>
            <div className="setting-controls">
              <button
                type="button"
                className={
                  settings.flow === 'paginated' ? 'reader-action is-selected' : 'reader-action'
                }
                onClick={() => settings.setFlow('paginated')}
              >
                {t('reader.paginated')}
              </button>
              <button
                type="button"
                className={
                  settings.flow === 'scrolled' ? 'reader-action is-selected' : 'reader-action'
                }
                onClick={() => settings.setFlow('scrolled')}
              >
                {t('reader.scrolled')}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </aside>
  );
};

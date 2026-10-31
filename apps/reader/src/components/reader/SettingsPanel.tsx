import { useTranslation } from 'react-i18next';
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  MARGIN_MAX,
  MARGIN_MIN,
  type ReaderFont,
  type ReaderSettings,
  type ReaderTheme,
} from '../../stores/readerSettingsStore';

interface SettingsPanelProps {
  settings: ReaderSettings;
  isPdf: boolean;
  onClose: () => void;
}

const FONTS: ReaderFont[] = ['vazirmatn', 'naskh', 'literata', 'sans', 'serif'];
const THEMES: ReaderTheme[] = ['auto', 'light', 'sepia', 'dark'];

export const SettingsPanel = ({ settings, isPdf, onClose }: SettingsPanelProps) => {
  const { t, i18n } = useTranslation();
  const numberFormat = new Intl.NumberFormat(i18n.language === 'fa' ? 'fa-IR' : 'en-US');
  const decimalFormat = new Intl.NumberFormat(i18n.language === 'fa' ? 'fa-IR' : 'en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

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
              aria-pressed={settings.pdfZoom === 'fit-page'}
              onClick={() => settings.setPdfZoom('fit-page')}
            >
              {t('reader.fitPage')}
            </button>
            <button
              type="button"
              className={
                settings.pdfZoom === 'fit-width' ? 'reader-action is-selected' : 'reader-action'
              }
              aria-pressed={settings.pdfZoom === 'fit-width'}
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
            <span>{t('reader.theme')}</span>
            <div className="setting-controls">
              {THEMES.map((theme) => (
                <button
                  key={theme}
                  type="button"
                  className={
                    settings.theme === theme ? 'reader-action is-selected' : 'reader-action'
                  }
                  aria-pressed={settings.theme === theme}
                  onClick={() => settings.setTheme(theme)}
                >
                  {t(`reader.themes.${theme}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <span>{t('reader.brightness')}</span>
            <div className="setting-controls">
              <input
                type="range"
                min={BRIGHTNESS_MIN}
                max={BRIGHTNESS_MAX}
                step={5}
                value={settings.brightness}
                aria-label={t('reader.brightness')}
                onChange={(event) => settings.setBrightness(Number(event.target.value))}
              />
              <span className="setting-value">{numberFormat.format(settings.brightness)}%</span>
            </div>
          </div>
          <div className="setting-row">
            <span>{t('reader.fontFamily')}</span>
            <select
              className="text-input"
              value={settings.fontFamily}
              aria-label={t('reader.fontFamily')}
              onChange={(event) => settings.setFontFamily(event.target.value as ReaderFont)}
            >
              {FONTS.map((font) => (
                <option key={font} value={font}>
                  {t(`reader.fonts.${font}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="setting-row">
            <span>{t('reader.fontSize')}</span>
            <div className="setting-controls">
              <button
                type="button"
                className="reader-action"
                aria-label={t('reader.decreaseFont')}
                disabled={settings.fontSize <= FONT_SIZE_MIN}
                onClick={settings.decreaseFont}
              >
                A−
              </button>
              <span className="setting-value">{numberFormat.format(settings.fontSize)}%</span>
              <button
                type="button"
                className="reader-action"
                aria-label={t('reader.increaseFont')}
                disabled={settings.fontSize >= FONT_SIZE_MAX}
                onClick={settings.increaseFont}
              >
                A+
              </button>
            </div>
          </div>
          <div className="setting-row">
            <span>{t('reader.lineHeight')}</span>
            <div className="setting-controls">
              <input
                type="range"
                min={LINE_HEIGHT_MIN}
                max={LINE_HEIGHT_MAX}
                step={0.1}
                value={settings.lineHeight}
                aria-label={t('reader.lineHeight')}
                onChange={(event) => settings.setLineHeight(Number(event.target.value))}
              />
              <span className="setting-value">{decimalFormat.format(settings.lineHeight)}</span>
            </div>
          </div>
          <div className="setting-row">
            <span>{t('reader.margin')}</span>
            <div className="setting-controls">
              <input
                type="range"
                min={MARGIN_MIN}
                max={MARGIN_MAX}
                step={8}
                value={settings.margin}
                aria-label={t('reader.margin')}
                onChange={(event) => settings.setMargin(Number(event.target.value))}
              />
              <span className="setting-value">
                {t('reader.pixels', { value: numberFormat.format(settings.margin) })}
              </span>
            </div>
          </div>
          <div className="setting-row">
            <span>{t('reader.justify')}</span>
            <button
              type="button"
              className={settings.justify ? 'reader-action is-selected' : 'reader-action'}
              aria-label={t('reader.justify')}
              aria-pressed={settings.justify}
              onClick={settings.toggleJustify}
            >
              {settings.justify ? t('reader.on') : t('reader.off')}
            </button>
          </div>
          <div className="setting-row">
            <span>{t('reader.hyphenate')}</span>
            <button
              type="button"
              className={settings.hyphenate ? 'reader-action is-selected' : 'reader-action'}
              aria-label={t('reader.hyphenate')}
              aria-pressed={settings.hyphenate}
              onClick={settings.toggleHyphenate}
            >
              {settings.hyphenate ? t('reader.on') : t('reader.off')}
            </button>
          </div>
          <div className="setting-row">
            <span>{t('reader.flow')}</span>
            <div className="setting-controls">
              <button
                type="button"
                className={
                  settings.flow === 'paginated' ? 'reader-action is-selected' : 'reader-action'
                }
                aria-pressed={settings.flow === 'paginated'}
                onClick={() => settings.setFlow('paginated')}
              >
                {t('reader.paginated')}
              </button>
              <button
                type="button"
                className={
                  settings.flow === 'scrolled' ? 'reader-action is-selected' : 'reader-action'
                }
                aria-pressed={settings.flow === 'scrolled'}
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

import { beforeEach, describe, expect, it } from 'vitest';
import { migrateReaderSettings, useReaderSettings } from './readerSettingsStore';

beforeEach(() => {
  useReaderSettings.setState({
    fontSize: 100,
    theme: 'auto',
    justify: true,
    flow: 'paginated',
    pdfZoom: 'fit-page',
  });
});

describe('readerSettingsStore', () => {
  it('clamps font size', () => {
    const { decreaseFont, increaseFont } = useReaderSettings.getState();
    for (let index = 0; index < 10; index += 1) decreaseFont();
    expect(useReaderSettings.getState().fontSize).toBe(70);
    for (let index = 0; index < 20; index += 1) increaseFont();
    expect(useReaderSettings.getState().fontSize).toBe(180);
  });

  it('toggles justification and switches theme and flow', () => {
    const { toggleJustify, setTheme, setFlow } = useReaderSettings.getState();
    toggleJustify();
    expect(useReaderSettings.getState().justify).toBe(false);
    setTheme('dark');
    expect(useReaderSettings.getState().theme).toBe('dark');
    setFlow('scrolled');
    expect(useReaderSettings.getState().flow).toBe('scrolled');
  });
});

describe('migrateReaderSettings', () => {
  it('maps the old light default to auto on the v1 store', () => {
    expect(migrateReaderSettings({ theme: 'light', fontSize: 110 }, 1)).toMatchObject({
      theme: 'auto',
      fontSize: 110,
    });
  });

  it('keeps themes that were explicitly chosen or migrated already', () => {
    expect(migrateReaderSettings({ theme: 'dark' }, 1)).toMatchObject({ theme: 'dark' });
    expect(migrateReaderSettings({ theme: 'sepia' }, 1)).toMatchObject({ theme: 'sepia' });
    expect(migrateReaderSettings({ theme: 'light' }, 2)).toMatchObject({ theme: 'light' });
  });

  it('tolerates malformed persisted state', () => {
    expect(migrateReaderSettings(null, 1)).toBeUndefined();
    expect(migrateReaderSettings('junk', 1)).toBeUndefined();
  });
});

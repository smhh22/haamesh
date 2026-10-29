import { beforeEach, describe, expect, it } from 'vitest';
import { useReaderSettings } from './readerSettingsStore';

beforeEach(() => {
  useReaderSettings.setState({
    fontSize: 100,
    theme: 'light',
    justify: true,
    flow: 'paginated',
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

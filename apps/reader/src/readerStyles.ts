import type { ReaderTheme } from './stores/readerSettingsStore';

export interface ReaderStyleInput {
  fontSize: number;
  theme: ReaderTheme;
  justify: boolean;
}

const THEMES = {
  light: { background: '#fffdf8', text: '#24211c', link: '#2f6f5e' },
  sepia: { background: '#f4ecd8', text: '#3a3125', link: '#7a5a2f' },
  dark: { background: '#1e1e1e', text: '#e6e1d8', link: '#8fc7b4' },
} as const satisfies Record<ReaderTheme, { background: string; text: string; link: string }>;

/**
 * Styles injected into every EPUB document. Font size scales the root, themes
 * set the page colors, and justification is explicit so publisher CSS cannot
 * silently override the user's choice.
 */
export const buildReaderCss = ({ fontSize, theme, justify }: ReaderStyleInput): string => {
  const colors = THEMES[theme];
  const alignment = justify ? 'justify' : 'start';

  return `
html { font-size: ${fontSize}% !important; }
body {
  background: ${colors.background} !important;
  color: ${colors.text} !important;
  line-height: 1.9 !important;
  letter-spacing: normal !important;
  hyphens: none !important;
  -webkit-hyphens: none !important;
  text-align: ${alignment} !important;
}
p, div, li, blockquote { text-align: ${alignment} !important; }
a { color: ${colors.link} !important; }
`;
};

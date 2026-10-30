import type { ReaderFlow, ReaderFont, ResolvedReaderTheme } from './stores/readerSettingsStore';

export interface ReaderStyleInput {
  fontSize: number;
  theme: ResolvedReaderTheme;
  justify: boolean;
  fontFamily: ReaderFont;
  lineHeight: number;
  hyphenate: boolean;
  flow: ReaderFlow;
  /** Page padding in px; applied as body padding in scrolled flow. */
  margin: number;
}

const THEMES = {
  light: { background: '#fffdf8', text: '#24211c', link: '#2f6f5e' },
  sepia: { background: '#f4ecd8', text: '#3a3125', link: '#7a5a2f' },
  dark: { background: '#14161a', text: '#e9e4d9', link: '#7fc7b0' },
} as const satisfies Record<
  ResolvedReaderTheme,
  { background: string; text: string; link: string }
>;

/**
 * Book iframes have their own document, so the app-level faces in tokens.css
 * never apply there; every reader document declares the bundled families it
 * may be asked to render. The URLs must be absolute: the paginator loads book
 * documents from blob: URLs, and path-relative URLs cannot resolve against a
 * blob base (the face then fails with a network error and silently falls back).
 */
const fontUrl = (file: string): string =>
  typeof window === 'undefined' ? `/fonts/${file}` : `${window.location.origin}/fonts/${file}`;

const FONT_FACES = `
@font-face { font-family: "Vazirmatn"; src: url("${fontUrl('Vazirmatn-Variable.woff2')}") format("woff2"); font-weight: 100 900; font-style: normal; font-display: swap; }
@font-face { font-family: "Noto Naskh Arabic"; src: url("${fontUrl('NotoNaskhArabic-Regular.woff2')}") format("woff2"); font-weight: 400; font-style: normal; font-display: swap; }
@font-face { font-family: "Literata"; src: url("${fontUrl('Literata-Regular.woff2')}") format("woff2"); font-weight: 400; font-style: normal; font-display: swap; }
`;

/** Bundled OFL faces first, then the closest system fallback. */
export const FONT_STACKS: Record<ReaderFont, string> = {
  vazirmatn: '"Vazirmatn", system-ui, sans-serif',
  naskh: '"Noto Naskh Arabic", "Vazirmatn", serif',
  literata: '"Literata", "Vazirmatn", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};

/**
 * Styles injected into every EPUB document. Font size scales the root, themes
 * set the page colors, and justification is explicit so publisher CSS cannot
 * silently override the user's choice. In paginated flow the page margin is
 * set on the renderer instead (see ReaderView); scrolled flow pads the body.
 */
export const buildReaderCss = ({
  fontSize,
  theme,
  justify,
  fontFamily,
  lineHeight,
  hyphenate,
  flow,
  margin,
}: ReaderStyleInput): string => {
  const colors = THEMES[theme];
  const alignment = justify ? 'justify' : 'start';
  const hyphens = hyphenate ? 'auto' : 'none';
  const padding =
    flow === 'scrolled'
      ? `padding-inline: ${margin}px !important; padding-block-end: ${margin}px !important;`
      : '';

  return `${FONT_FACES}
html { font-size: ${fontSize}% !important; }
body {
  background: ${colors.background} !important;
  color: ${colors.text} !important;
  font-family: ${FONT_STACKS[fontFamily]} !important;
  line-height: ${lineHeight} !important;
  letter-spacing: normal !important;
  hyphens: ${hyphens} !important;
  -webkit-hyphens: ${hyphens} !important;
  text-align: ${alignment} !important;
  ${padding}
}
p, div, li, blockquote { text-align: ${alignment} !important; }
a { color: ${colors.link} !important; }
`;
};

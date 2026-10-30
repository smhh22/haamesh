const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const SCRIPT_SELF_CLOSING = /<script\b[^>]*\/\s*>/gi;
const DANGEROUS_ELEMENTS =
  /<(iframe|object|embed|base|form)\b[^>]*>[\s\S]*?<\/\1\s*>|<(iframe|object|embed|base|form)\b[^>]*\/?\s*>(?:[\s\S]*?<\/\2\s*>)?/gi;
const META_REFRESH = /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi;
const EVENT_HANDLER = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const URL_ATTR =
  /\s(href|src|srcset|action|formaction|xlink:href|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/** Decode numeric/named entities and strip URL-whitespace so encoded schemes are visible. */
const decodeUrlValue = (value: string): string => {
  const decoded = value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&(Tab|NewLine);/gi, ' ');
  return decoded
    .replace(/[\t\n\r]/g, '')
    .split(NUL)
    .join('');
};

// NUL never participates in URL schemes (browsers strip only tab/CR/LF), so
// the whitespace-leading checks below are sufficient.
const isDangerousUrl = (value: string): boolean =>
  /^\s*(?:javascript|vbscript):/i.test(value) || /^\s*data:text\/html/i.test(value);
const CSP_HEADER = /http-equiv=["']Content-Security-Policy/i;

const NUL = String.fromCharCode(0);

const CSP_META =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob:; font-src 'self' blob: data:; media-src blob: data:; connect-src 'none'; frame-src 'none';\"/>";

/**
 * Remove active content from an EPUB document before it enters the reader
 * iframe, and inject a CSP that blocks network access.
 *
 * The iframe sandbox must allow scripts for foliate-js event handling on
 * WebKit, so this sanitizer is the security control. Stripping runs to a
 * fixed point so reassembly tricks like `<scr<script>ipt>` cannot resurrect
 * a tag. Replace it with a DOM sanitizer before annotations or user-authored
 * HTML ship.
 */
export const sanitizeEpubHtml = (html: string): string => {
  let current = html;
  // Fixed point: each pass can expose new tags formed by removals.
  for (let pass = 0; pass < 8; pass += 1) {
    const next = current
      .replace(SCRIPT_BLOCK, '')
      .replace(SCRIPT_SELF_CLOSING, '')
      .replace(DANGEROUS_ELEMENTS, '')
      .replace(META_REFRESH, '')
      .replace(EVENT_HANDLER, '')
      .replace(URL_ATTR, (match, _attr: string, dq: string, sq: string, bare: string) => {
        const raw = dq ?? sq ?? bare ?? '';
        if (isDangerousUrl(decodeUrlValue(raw)) || isDangerousUrl(raw)) return '';
        return match;
      });
    if (next === current) break;
    current = next;
  }

  // Kill any leftover partial script tags that survived reassembly.
  const stripped = current.replace(/<\s*\/?\s*script[^>]*>/gi, '');

  if (CSP_HEADER.test(stripped)) return stripped;
  if (/<head\b[^>]*>/i.test(stripped)) {
    return stripped.replace(/<head\b[^>]*>/i, (head) => `${head}${CSP_META}`);
  }
  // Documents without <head> get a synthetic one; a meta CSP outside head is
  // ignored by browsers per spec.
  const head = /<html\b[^>]*>/i.test(stripped)
    ? stripped.replace(/<html\b[^>]*>/i, (tag) => `${tag}<head>${CSP_META}</head>`)
    : `<head>${CSP_META}</head>${stripped}`;
  return head;
};

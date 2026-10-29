const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const SCRIPT_SELF_CLOSING = /<script\b[^>]*\/\s*>/gi;
const EVENT_HANDLER = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL = /\s(?:href|src|srcset)\s*=\s*(?:"|')?\s*javascript:[^"'\s>]*/gi;
const CSP_HEADER = /http-equiv=["']Content-Security-Policy/i;

const CSP_META =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob:; font-src blob: data:; media-src blob: data:; connect-src 'none'; frame-src 'none';\"/>";

/**
 * Remove active content from an EPUB document before it enters the reader
 * iframe, and inject a CSP that blocks network access.
 *
 * The iframe sandbox must allow scripts for foliate-js event handling on
 * WebKit, so this sanitizer is the security control. It is intentionally
 * conservative and regex-based; replace it with a DOM sanitizer before
 * annotations or user-authored HTML ship.
 */
export const sanitizeEpubHtml = (html: string): string => {
  const stripped = html
    .replace(SCRIPT_BLOCK, '')
    .replace(SCRIPT_SELF_CLOSING, '')
    .replace(EVENT_HANDLER, '')
    .replace(JS_URL, '');

  if (CSP_HEADER.test(stripped)) return stripped;
  if (/<head\b[^>]*>/i.test(stripped)) {
    return stripped.replace(/<head\b[^>]*>/i, (head) => `${head}${CSP_META}`);
  }
  return `${CSP_META}${stripped}`;
};

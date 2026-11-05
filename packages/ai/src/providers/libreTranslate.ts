/**
 * LibreTranslate provider: the user runs the server (Docker/pip), optionally
 * with API keys; nothing leaves their machine or LAN unless they point at a
 * public instance (LibreTranslate is AGPL — it runs as THEIR server, never
 * linked into Hāmesh).
 */
import type {
  FetchPort,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from '../types';
import { mapFetchError, TranslationError } from '../types';

export interface LibreTranslateConfig {
  /** Base URL of the user's instance, e.g. http://192.168.1.10:5000 */
  baseUrl: string;
  apiKey?: string;
}

interface LibreTranslateResponse {
  translatedText?: unknown;
  error?: unknown;
}

export const createLibreTranslateProvider = (
  config: LibreTranslateConfig,
  fetchPort: FetchPort,
): TranslationProvider => ({
  id: 'libretranslate',
  label: 'LibreTranslate',
  capabilities: { maxChars: 4000, needsKey: false, worksInWeb: true },
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    if (request.text.length > 4000) {
      throw new TranslationError('TOO_LONG', 'LibreTranslate accepts up to 4000 characters');
    }
    const base = config.baseUrl.replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) {
      throw new TranslationError('PROVIDER_ERROR', 'invalid LibreTranslate URL');
    }
    const payload: Record<string, unknown> = {
      q: request.text,
      source: request.sourceLang === 'auto' ? 'auto' : request.sourceLang,
      target: request.targetLang,
      format: 'text',
    };
    if (config.apiKey) payload.api_key = config.apiKey;
    let response: Response;
    try {
      response = await fetchPort(`${base}/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: request.signal,
      });
    } catch (error) {
      throw mapFetchError(error);
    }
    if (response.status === 401 || response.status === 403) {
      throw new TranslationError('AUTH');
    }
    if (response.status === 429) throw new TranslationError('RATE_LIMITED');
    const body = (await response.json().catch(() => null)) as LibreTranslateResponse | null;
    if (response.status === 400) {
      const detail = typeof body?.error === 'string' ? body.error : 'bad request';
      throw new TranslationError(
        /language/i.test(detail) ? 'UNSUPPORTED_LANG' : 'PROVIDER_ERROR',
        detail,
      );
    }
    if (!response.ok) {
      throw new TranslationError('PROVIDER_ERROR', `HTTP ${response.status}`);
    }
    const translated = body?.translatedText;
    if (typeof translated !== 'string' || translated.length === 0) {
      throw new TranslationError('PROVIDER_ERROR', 'empty translation');
    }
    return { text: translated };
  },
});

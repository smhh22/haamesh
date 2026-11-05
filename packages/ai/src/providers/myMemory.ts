/**
 * MyMemory translation provider: official free API, keyless, CORS-friendly.
 * Selection-sized text only (5,000 chars/day anonymous; see ADR-0016).
 */
import type {
  FetchPort,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from '../types';
import { mapFetchError, TranslationError } from '../types';

export interface MyMemoryConfig {
  /** Optional validated email raises the daily limit (per MyMemory docs). */
  email?: string;
}

interface MyMemoryResponse {
  responseStatus?: number | string;
  responseData?: { translatedText?: unknown };
  responseDetails?: string;
}

export const createMyMemoryProvider = (
  config: MyMemoryConfig,
  fetchPort: FetchPort,
): TranslationProvider => ({
  id: 'mymemory',
  label: 'MyMemory',
  capabilities: { maxChars: 450, needsKey: false, worksInWeb: true },
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    if (request.text.length > 450) {
      throw new TranslationError('TOO_LONG', `MyMemory accepts up to 450 characters`);
    }
    const source = request.sourceLang === 'auto' ? 'Autodetect' : request.sourceLang;
    const parameters = new URLSearchParams({
      q: request.text,
      langpair: `${source}|${request.targetLang}`,
    });
    if (config.email) parameters.set('de', config.email);
    let response: Response;
    try {
      response = await fetchPort(`https://api.mymemory.translated.net/get?${parameters}`, {
        signal: request.signal,
      });
    } catch (error) {
      throw mapFetchError(error);
    }
    if (response.status === 429) throw new TranslationError('RATE_LIMITED');
    if (response.status === 403) throw new TranslationError('QUOTA', 'daily limit reached');
    if (!response.ok) {
      throw new TranslationError('PROVIDER_ERROR', `HTTP ${response.status}`);
    }
    const body = (await response.json()) as MyMemoryResponse;
    const status = Number(body.responseStatus);
    if (status === 429) throw new TranslationError('RATE_LIMITED');
    if (status === 403) throw new TranslationError('QUOTA', body.responseDetails ?? null);
    if (!Number.isFinite(status) || status !== 200) {
      throw new TranslationError(
        'PROVIDER_ERROR',
        body.responseDetails ?? `status ${String(body.responseStatus)}`,
      );
    }
    const translated = body.responseData?.translatedText;
    if (typeof translated !== 'string' || translated.length === 0) {
      throw new TranslationError('PROVIDER_ERROR', 'empty translation');
    }
    return { text: translated };
  },
});

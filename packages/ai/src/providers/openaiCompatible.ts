/**
 * OpenAI-compatible translation via chat completions: any endpoint the user
 * configures (OpenAI, OpenRouter, Groq, Together, Ollama, LM Studio, …).
 * The prompt harness keeps the output translation-only.
 */
import { buildTranslateSystemPrompt, buildTranslateUserPrompt } from '../prompts/translate';
import type {
  FetchPort,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from '../types';
import { languageName, mapFetchError, TranslationError } from '../types';

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  bookTitle?: string | null;
  bookAuthor?: string | null;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  error?: { message?: unknown };
}

export const createOpenAiCompatibleTranslationProvider = (
  config: OpenAiCompatibleConfig,
  fetchPort: FetchPort,
): TranslationProvider => ({
  id: 'openai-compatible',
  label: 'OpenAI-compatible',
  capabilities: { maxChars: 6000, needsKey: false, worksInWeb: true },
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    if (request.text.length > 6000) {
      throw new TranslationError('TOO_LONG', 'accepts up to 6000 characters per request');
    }
    const base = config.baseUrl.replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) {
      throw new TranslationError('PROVIDER_ERROR', 'invalid base URL');
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
    let response: Response;
    try {
      response = await fetchPort(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          stream: false,
          messages: [
            {
              role: 'system',
              content: buildTranslateSystemPrompt({
                sourceLang: languageName(request.sourceLang ?? 'auto'),
                targetLang: languageName(request.targetLang),
                bookTitle: config.bookTitle ?? null,
                bookAuthor: config.bookAuthor ?? null,
              }),
            },
            { role: 'user', content: buildTranslateUserPrompt(request.text) },
          ],
        }),
        signal: request.signal,
      });
    } catch (error) {
      throw mapFetchError(error);
    }
    if (response.status === 401) throw new TranslationError('AUTH');
    if (response.status === 402 || response.status === 403) {
      throw new TranslationError('QUOTA');
    }
    if (response.status === 429) throw new TranslationError('RATE_LIMITED');
    const body = (await response.json().catch(() => null)) as ChatCompletionResponse | null;
    if (!response.ok) {
      const detail =
        typeof body?.error?.message === 'string' ? body.error.message : `HTTP ${response.status}`;
      throw new TranslationError('PROVIDER_ERROR', detail);
    }
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new TranslationError('PROVIDER_ERROR', 'empty completion');
    }
    return { text: content.trim() };
  },
});

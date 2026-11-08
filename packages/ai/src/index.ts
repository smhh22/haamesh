export type { CacheKeyInput } from './cacheKey';
export { translationCacheKey } from './cacheKey';
export type { DictionaryEntry, DictionaryErrorCode } from './dictionary';
export {
  DictionaryError,
  lookupWord,
  wikipediaSummary,
  wiktionaryDefinition,
  wiktionaryNativeParse,
} from './dictionary';
export { sha256Hex } from './hash';
export type { TranslatePromptInput } from './prompts/translate';
export {
  buildTranslateSystemPrompt,
  buildTranslateUserPrompt,
  PROMPT_VERSION,
} from './prompts/translate';
export type { LibreTranslateConfig } from './providers/libreTranslate';
export { createLibreTranslateProvider } from './providers/libreTranslate';
export type { MyMemoryConfig } from './providers/myMemory';
export { createMyMemoryProvider } from './providers/myMemory';
export type { OpenAiCompatibleConfig } from './providers/openaiCompatible';
export { createOpenAiCompatibleTranslationProvider } from './providers/openaiCompatible';
export type {
  FetchPort,
  TranslationCapabilities,
  TranslationErrorCode,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from './types';
export { languageName, mapFetchError, TranslationError } from './types';

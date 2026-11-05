/**
 * Translation settings (ADR-0016). Provider configs are device-local; API
 * keys live in the OS keychain (web: localStorage fallback, same warning as
 * sync). Nothing here is synced.
 */
import { keychainDelete, keychainGet, keychainSet } from './keychain';

export type TranslationProviderKind = 'mymemory' | 'libretranslate' | 'openai-compatible';

export interface TranslationProviderConfig {
  id: string;
  kind: TranslationProviderKind;
  label: string;
  enabled: boolean;
  /** LibreTranslate / OpenAI-compatible base URL. */
  baseUrl: string;
  /** OpenAI-compatible model name. */
  model: string;
  /** MyMemory optional contact email (raises the daily limit). */
  email: string;
  /** Runtime only; persisted to the keychain. */
  apiKey: string;
  hasApiKey: boolean;
  /** Optional per-provider HTTP/SOCKS proxy (empty = direct). */
  proxy: string;
}

export interface AiTranslationSettings {
  providers: TranslationProviderConfig[];
  /** Target language for translations; independent of the UI locale. */
  targetLang: string;
  /** Opt-in: tapping a paragraph translates it (EPUB only). */
  tapToTranslate: boolean;
}

const SETTINGS_KEY = 'hamesh.ai.translation';
const SECRET_PREFIX = 'ai.translation.key.';

const apiKeyKey = (providerId: string): string => `${SECRET_PREFIX}${providerId}`;

export const newTranslationProvider = (
  kind: TranslationProviderKind,
  overrides: Partial<TranslationProviderConfig> = {},
): TranslationProviderConfig => ({
  id: crypto.randomUUID(),
  kind,
  label:
    kind === 'mymemory'
      ? 'MyMemory'
      : kind === 'libretranslate'
        ? 'LibreTranslate'
        : 'OpenAI-compatible',
  enabled: true,
  baseUrl: kind === 'libretranslate' ? 'http://localhost:5000' : '',
  model: '',
  email: '',
  apiKey: '',
  hasApiKey: false,
  proxy: '',
  ...overrides,
});

export const defaultAiSettings = (uiLocale: string): AiTranslationSettings => ({
  providers: [],
  targetLang: uiLocale,
  tapToTranslate: false,
});

export const loadAiSettings = (uiLocale: string): AiTranslationSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultAiSettings(uiLocale);
    const parsed = JSON.parse(raw) as Partial<AiTranslationSettings>;
    const providers = Array.isArray(parsed.providers) ? parsed.providers : [];
    return {
      providers,
      targetLang:
        typeof parsed.targetLang === 'string' && parsed.targetLang ? parsed.targetLang : uiLocale,
      tapToTranslate: parsed.tapToTranslate === true,
    };
  } catch {
    return defaultAiSettings(uiLocale);
  }
};

/** Persist settings; secrets are moved to the keychain and stripped. */
export const saveAiSettings = (settings: AiTranslationSettings): void => {
  const stored: AiTranslationSettings = {
    ...settings,
    providers: settings.providers.map((provider) => {
      if (provider.apiKey) {
        void keychainSet(apiKeyKey(provider.id), provider.apiKey);
      } else if (!provider.hasApiKey) {
        void keychainDelete(apiKeyKey(provider.id));
      }
      return {
        ...provider,
        apiKey: '',
        hasApiKey: provider.hasApiKey || Boolean(provider.apiKey),
      };
    }),
  };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
  } catch {
    // storage may be unavailable; settings stay in memory for this session
  }
};

/** Fill API keys from the keychain when they were persisted earlier. */
export const resolveAiSecrets = async (
  provider: TranslationProviderConfig,
): Promise<TranslationProviderConfig> => {
  if (provider.apiKey || !provider.hasApiKey) return provider;
  const apiKey = (await keychainGet(apiKeyKey(provider.id))) ?? '';
  return { ...provider, apiKey };
};

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type AiTranslationSettings,
  loadAiSettings,
  newTranslationProvider,
  resolveAiSecrets,
  saveAiSettings,
  type TranslationProviderConfig,
  type TranslationProviderKind,
} from '../services/aiSettings';
import { providerFetch } from '../services/httpFetch';
import { getActiveStorage } from '../services/libraryPersistence';
import { providerFromConfig } from '../services/translateService';
import { useUiStore } from '../stores/uiStore';

const TARGET_LANGUAGES = ['fa', 'en', 'ar', 'tr', 'fr', 'de', 'ru', 'zh', 'ja'] as const;

interface CardState {
  testing: boolean;
  result: 'ok' | 'failed' | null;
  detail: string;
}

/**
 * Translation settings (ADR-0016): provider cards, target language,
 * tap-to-translate, cache controls. Secrets never render back after saving.
 */
export const TranslationSettings = () => {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const [settings, setSettings] = useState<AiTranslationSettings>(() => loadAiSettings(locale));
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [cacheCount, setCacheCount] = useState<number | null>(null);

  useEffect(() => {
    const cache = getActiveStorage()?.translationCache;
    if (!cache) return;
    void cache
      .count()
      .then(setCacheCount)
      .catch(() => setCacheCount(null));
  }, []);

  const update = (next: AiTranslationSettings) => {
    setSettings(next);
    saveAiSettings(next);
  };

  const patchProvider = (id: string, patch: Partial<TranslationProviderConfig>) => {
    update({
      ...settings,
      providers: settings.providers.map((provider) =>
        provider.id === id ? { ...provider, ...patch } : provider,
      ),
    });
  };

  const addProvider = (kind: TranslationProviderKind) => {
    update({ ...settings, providers: [...settings.providers, newTranslationProvider(kind)] });
  };

  const removeProvider = (id: string) => {
    update({ ...settings, providers: settings.providers.filter((provider) => provider.id !== id) });
  };

  const testProvider = async (provider: TranslationProviderConfig) => {
    setCards((current) => ({
      ...current,
      [provider.id]: { testing: true, result: null, detail: '' },
    }));
    try {
      // A key saved in an earlier session lives in the keychain, not in the
      // config; resolve it or the test fails with AUTH for working providers.
      const resolved = await resolveAiSecrets(provider);
      const built = providerFromConfig(resolved, providerFetch(provider.proxy) as never);
      if (!built) throw new Error('incomplete configuration');
      const result = await built.translate({
        text: 'hello',
        sourceLang: 'en',
        targetLang: settings.targetLang,
      });
      setCards((current) => ({
        ...current,
        [provider.id]: {
          testing: false,
          result: 'ok',
          detail: `${built.label}: ${result.text.slice(0, 60)}`,
        },
      }));
    } catch (error) {
      setCards((current) => ({
        ...current,
        [provider.id]: {
          testing: false,
          result: 'failed',
          detail: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  };

  const clearCache = async () => {
    const cache = getActiveStorage()?.translationCache;
    if (!cache) return;
    await cache.clear();
    setCacheCount(0);
  };

  return (
    <>
      <div className="setting-row">
        <span>{t('ai.targetLanguage')}</span>
        <select
          className="sort-select"
          value={settings.targetLang}
          onChange={(event) => update({ ...settings, targetLang: event.target.value })}
          aria-label={t('ai.targetLanguage')}
        >
          {TARGET_LANGUAGES.map((tag) => (
            <option key={tag} value={tag}>
              {t(`ai.languages.${tag}`)}
            </option>
          ))}
        </select>
      </div>

      <h3 className="settings-section-title">{t('ai.providersTitle')}</h3>
      <p className="hint">{t('ai.providersHint')}</p>

      {settings.providers.map((provider) => {
        const card = cards[provider.id];
        return (
          <div key={provider.id} className="ai-provider-card">
            <div className="ai-provider-head">
              <strong>{provider.label}</strong>
              <label className="ai-provider-enabled">
                <input
                  type="checkbox"
                  checked={provider.enabled}
                  onChange={(event) =>
                    patchProvider(provider.id, { enabled: event.currentTarget.checked })
                  }
                  aria-label={t('ai.enabled')}
                />
                {t('ai.enabled')}
              </label>
              <button
                type="button"
                className="text-button"
                onClick={() => removeProvider(provider.id)}
              >
                {t('ai.remove')}
              </button>
            </div>

            {provider.kind === 'mymemory' ? (
              <div className="setting-row is-field">
                <label htmlFor={`ai-email-${provider.id}`}>{t('ai.emailOptional')}</label>
                <input
                  className="text-input"
                  id={`ai-email-${provider.id}`}
                  type="email"
                  dir="ltr"
                  value={provider.email}
                  onChange={(event) =>
                    patchProvider(provider.id, { email: event.currentTarget.value })
                  }
                />
              </div>
            ) : (
              <div className="setting-row is-field">
                <label htmlFor={`ai-base-${provider.id}`}>{t('ai.baseUrl')}</label>
                <input
                  className="text-input"
                  id={`ai-base-${provider.id}`}
                  type="url"
                  dir="ltr"
                  value={provider.baseUrl}
                  placeholder={
                    provider.kind === 'libretranslate'
                      ? 'http://localhost:5000'
                      : 'https://api.example.com/v1'
                  }
                  onChange={(event) =>
                    patchProvider(provider.id, { baseUrl: event.currentTarget.value })
                  }
                />
              </div>
            )}

            {provider.kind === 'openai-compatible' ? (
              <div className="setting-row is-field">
                <label htmlFor={`ai-model-${provider.id}`}>{t('ai.model')}</label>
                <input
                  className="text-input"
                  id={`ai-model-${provider.id}`}
                  type="text"
                  dir="ltr"
                  value={provider.model}
                  placeholder="gpt-4o-mini"
                  onChange={(event) =>
                    patchProvider(provider.id, { model: event.currentTarget.value })
                  }
                />
              </div>
            ) : null}

            {provider.kind !== 'mymemory' ? (
              <div className="setting-row is-field">
                <label htmlFor={`ai-key-${provider.id}`}>{t('ai.apiKey')}</label>
                <input
                  className="text-input"
                  id={`ai-key-${provider.id}`}
                  type="password"
                  dir="ltr"
                  value={provider.apiKey}
                  autoComplete="off"
                  placeholder={provider.hasApiKey ? t('ai.keySaved') : undefined}
                  onChange={(event) =>
                    patchProvider(provider.id, { apiKey: event.currentTarget.value })
                  }
                />
              </div>
            ) : null}

            <div className="setting-row is-field">
              <label htmlFor={`ai-proxy-${provider.id}`}>{t('ai.proxy')}</label>
              <input
                className="text-input"
                id={`ai-proxy-${provider.id}`}
                type="text"
                dir="ltr"
                value={provider.proxy}
                placeholder="socks5h://127.0.0.1:2080"
                onChange={(event) =>
                  patchProvider(provider.id, { proxy: event.currentTarget.value })
                }
              />
            </div>

            <div className="ai-provider-actions">
              <button
                type="button"
                className="text-button"
                disabled={card?.testing}
                onClick={() => void testProvider(provider)}
              >
                {card?.testing ? t('ai.testing') : t('ai.test')}
              </button>
              {card?.detail ? (
                <span className={card.result === 'ok' ? 'ai-test-ok' : 'ai-test-failed'} dir="auto">
                  {card.detail}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}

      <div className="ai-add-providers">
        <button type="button" className="reader-action" onClick={() => addProvider('mymemory')}>
          + MyMemory
        </button>
        <button
          type="button"
          className="reader-action"
          onClick={() => addProvider('libretranslate')}
        >
          + LibreTranslate
        </button>
        <button
          type="button"
          className="reader-action"
          onClick={() => addProvider('openai-compatible')}
        >
          + OpenAI-compatible
        </button>
      </div>

      <div className="setting-row">
        <span>
          {t('ai.cache')}
          {cacheCount !== null ? ` — ${t('ai.cacheCount', { count: cacheCount })}` : ''}
        </span>
        <button type="button" className="text-button" onClick={() => void clearCache()}>
          {t('ai.clearCache')}
        </button>
      </div>
      <p className="hint">{t('ai.privacyNote')}</p>
    </>
  );
};

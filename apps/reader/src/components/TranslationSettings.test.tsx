import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { useUiStore } from '../stores/uiStore';
import { TranslationSettings } from './TranslationSettings';

const { keychainGet, keychainSet, keychainDelete } = vi.hoisted(() => ({
  keychainGet: vi.fn(async () => 'stored-secret'),
  keychainSet: vi.fn(async () => undefined),
  keychainDelete: vi.fn(async () => undefined),
}));

vi.mock('../services/keychain', () => ({ keychainGet, keychainSet, keychainDelete }));

const storedSettings = {
  providers: [
    {
      id: 'p1',
      kind: 'openai-compatible',
      label: 'OpenAI-compatible',
      enabled: true,
      baseUrl: 'https://llm.example/v1',
      model: 'gpt-test',
      email: '',
      apiKey: '',
      hasApiKey: true,
      proxy: '',
    },
  ],
  targetLang: 'fa',
};

beforeEach(async () => {
  localStorage.clear();
  vi.clearAllMocks();
  useUiStore.setState({ locale: 'en' });
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TranslationSettings provider test', () => {
  it('resolves a saved key from the keychain before calling the provider', async () => {
    localStorage.setItem('hamesh.ai.translation', JSON.stringify(storedSettings));
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'سلام' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<TranslationSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => {
      expect(screen.getByText('OpenAI-compatible: سلام')).toBeInTheDocument();
    });
    expect(keychainGet).toHaveBeenCalledWith('ai.translation.key.p1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect(init.headers).toMatchObject({ authorization: 'Bearer stored-secret' });
  });

  it('reports a failed test instead of throwing', async () => {
    localStorage.setItem('hamesh.ai.translation', JSON.stringify(storedSettings));
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<TranslationSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => {
      expect(screen.getByText('AUTH')).toBeInTheDocument();
    });
  });
});

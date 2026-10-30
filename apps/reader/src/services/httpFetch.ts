/**
 * Fetch-compatible bridge to the Rust HTTP client. Desktop sync providers use
 * this so requests can go through an HTTP or SOCKS5 proxy (sanctioned
 * networks) and bypass webview CORS; the web build keeps plain fetch.
 */
import type { FetchLike } from '@hamesh/sync';
import { isTauriRuntime } from './dataStore';

interface HttpResult {
  status: number;
  headers: Array<[string, string]>;
  body: number[];
}

const bodyBytes = async (body: BodyInit | null | undefined): Promise<number[] | null> => {
  if (body === null || body === undefined) return null;
  if (typeof body === 'string') return Array.from(new TextEncoder().encode(body));
  if (body instanceof ArrayBuffer) return Array.from(new Uint8Array(body));
  if (ArrayBuffer.isView(body)) {
    return Array.from(new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength));
  }
  if (body instanceof Blob) return Array.from(new Uint8Array(await body.arrayBuffer()));
  return null;
};

export const createTauriFetch =
  (proxy: string | null): FetchLike =>
  async (input, init) => {
    const { invoke } = await import('@tauri-apps/api/core');
    const url = input;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const result = await invoke<HttpResult>('http_request', {
      method: init?.method ?? 'GET',
      url,
      headers,
      body: await bodyBytes(init?.body),
      proxy: proxy || null,
    });
    return new Response(new Uint8Array(result.body), {
      status: result.status,
      headers: result.headers,
    });
  };

/** Provider fetch: proxy-aware bridge on desktop, plain fetch on the web. */
export const providerFetch = (proxy: string): FetchLike => {
  if (isTauriRuntime()) return createTauriFetch(proxy || null);
  return (input, init) => fetch(input, init);
};

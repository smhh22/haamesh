import { ImportError } from './error';

export const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new ImportError(
      'CRYPTO_UNAVAILABLE',
      'Web Crypto is unavailable; use HTTPS or localhost.',
    );
  }
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

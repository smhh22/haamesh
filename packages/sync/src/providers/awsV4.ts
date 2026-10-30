/**
 * AWS Signature Version 4 signer (header-based). Pure except for WebCrypto,
 * with an injectable date so the AWS test vectors can drive it.
 *
 * Verified against the official aws-sig-v4 test vectors (see s3.test.ts).
 */

export interface SignOptions {
  method: string;
  /** Fully-qualified URL (query string optional). */
  url: string;
  /** Header name -> value, excluding host/x-amz-date/x-amz-content-sha256. */
  headers?: Record<string, string>;
  /** Hex SHA-256 of the request body, or the empty-body hash. */
  payloadHash: string;
  /** S3 requires x-amz-content-sha256; the generic SigV4 vectors do not. */
  contentSha256Header?: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  /** ISO timestamp used for x-amz-date (injectable for tests). */
  date: Date;
}

export const EMPTY_PAYLOAD_HASH =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const encoder = new TextEncoder();

export const sha256Hex = async (data: Uint8Array | string): Promise<string> => {
  const bytes: Uint8Array<ArrayBuffer> =
    typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const hmac = async (key: Uint8Array, data: string): Promise<Uint8Array> => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key.slice().buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return new Uint8Array(signature);
};

/** RFC 3986 encoding; `encodeSlash=false` keeps path separators. */
export const uriEncode = (value: string, encodeSlash = true): string =>
  value
    .split('')
    .map((char) => {
      if (/[A-Za-z0-9._~-]/.test(char)) return char;
      if (char === '/' && !encodeSlash) return char;
      return Array.from(encoder.encode(char))
        .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
        .join('');
    })
    .join('');

const canonicalUri = (pathname: string): string =>
  uriEncode(decodeURIComponent(pathname), false) || '/';

const canonicalQuery = (search: string): string => {
  const params = new URLSearchParams(search);
  const pairs: Array<[string, string]> = [];
  for (const [key, value] of params.entries()) {
    pairs.push([uriEncode(key), uriEncode(value)]);
  }
  return pairs
    .sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
};

export interface SignedRequest {
  headers: Record<string, string>;
  authorization: string;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

export const signAwsV4 = async (options: SignOptions): Promise<SignedRequest> => {
  const url = new URL(options.url);
  const amzDate = options.date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);

  const allHeaders: Record<string, string> = {
    ...(options.headers ?? {}),
    host: url.host,
    'x-amz-date': amzDate,
  };
  if (options.contentSha256Header) {
    allHeaders['x-amz-content-sha256'] = options.payloadHash;
  }
  const sortedNames = Object.keys(allHeaders)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = sortedNames
    .map((name) => {
      const value =
        Object.entries(allHeaders).find(([key]) => key.toLowerCase() === name)?.[1] ?? '';
      return `${name}:${value.trim()}\n`;
    })
    .join('');
  const signedHeaders = sortedNames.join(';');

  const canonicalRequest = [
    options.method.toUpperCase(),
    canonicalUri(url.pathname),
    canonicalQuery(url.search),
    canonicalHeaders,
    signedHeaders,
    options.payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${options.region}/${options.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join(
    '\n',
  );

  const kDate = await hmac(encoder.encode(`AWS4${options.secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, options.region);
  const kService = await hmac(kRegion, options.service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = Array.from(await hmac(kSigning, stringToSign))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return {
    headers: allHeaders,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    canonicalRequest,
    stringToSign,
    signature,
  };
};

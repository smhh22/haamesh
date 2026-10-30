import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EMPTY_PAYLOAD_HASH, signAwsV4 } from './awsV4';

// jsdom's crypto lacks SubtleCrypto; the app runs in secure contexts where it
// exists, so tests borrow Node's implementation.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

const SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
const DATE = new Date('2015-08-30T12:36:00Z');

/**
 * Official aws-sig-v4 test vectors (from the botocore aws4_testsuite copy of
 * the AWS suite): get-vanilla and get-vanilla-query-order-key-case.
 */
describe('signAwsV4 — AWS test vectors', () => {
  it('matches get-vanilla', async () => {
    const signed = await signAwsV4({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      payloadHash: EMPTY_PAYLOAD_HASH,
      contentSha256Header: false,
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: SECRET,
      region: 'us-east-1',
      service: 'service',
      date: DATE,
    });
    expect(signed.canonicalRequest).toContain('host:example.amazonaws.com');
    expect(signed.signature).toBe(
      '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('matches get-vanilla-query-order-key-case', async () => {
    const signed = await signAwsV4({
      method: 'GET',
      url: 'https://example.amazonaws.com/?Param2=value2&Param1=value1',
      payloadHash: EMPTY_PAYLOAD_HASH,
      contentSha256Header: false,
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: SECRET,
      region: 'us-east-1',
      service: 'service',
      date: DATE,
    });
    // Expected from the suite's .authz file for this case.
    expect(signed.signature).toBe(
      'b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500',
    );
  });
});

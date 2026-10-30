import { describe, expect, it } from 'vitest';
import { providerConformanceChecks } from './conformance';
import type { StorageProvider } from './provider';

/** Vitest wrapper; test-only module, never exported from the package entry. */
export const describeProviderConformance = (createProvider: () => StorageProvider): void => {
  describe('provider conformance', () => {
    for (const check of providerConformanceChecks) {
      it(check.name, async () => {
        await expect(check.run(createProvider)).resolves.toBeUndefined();
      });
    }
  });
};

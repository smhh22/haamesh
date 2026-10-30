import { describeProviderConformance } from '../conformance.vitest';
import { createMemoryProvider } from './memory';

describeProviderConformance(() => createMemoryProvider());

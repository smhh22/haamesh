import { runProviderConformance } from '../conformance';
import { createMemoryProvider } from './memory';

runProviderConformance(() => createMemoryProvider());

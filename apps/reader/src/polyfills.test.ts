import { afterEach, describe, expect, it, vi } from 'vitest';

const objectDescriptor = Object.getOwnPropertyDescriptor(Object, 'groupBy');
const mapDescriptor = Object.getOwnPropertyDescriptor(Map, 'groupBy');

afterEach(() => {
  if (objectDescriptor) Object.defineProperty(Object, 'groupBy', objectDescriptor);
  else Reflect.deleteProperty(Object, 'groupBy');
  if (mapDescriptor) Object.defineProperty(Map, 'groupBy', mapDescriptor);
  else Reflect.deleteProperty(Map, 'groupBy');
});

type GroupByFunction = <T>(
  items: Iterable<T>,
  callback: (item: T, index: number) => PropertyKey,
) => Record<string, T[]>;

describe('groupBy polyfills', () => {
  it('groups with index-aware callbacks and a null prototype', async () => {
    Reflect.deleteProperty(Object, 'groupBy');
    Reflect.deleteProperty(Map, 'groupBy');
    vi.resetModules();
    await import('./polyfills');

    const objectGroupBy = (Object as unknown as { groupBy: GroupByFunction }).groupBy;
    const grouped = objectGroupBy(['a', 'bb', 'c'], (_item, index) => index % 2);
    expect(Object.getPrototypeOf(grouped)).toBeNull();
    expect(grouped['0']).toEqual(['a', 'c']);
    expect(grouped['1']).toEqual(['bb']);

    const mapGroupBy = (
      Map as unknown as {
        groupBy: <T, K>(items: Iterable<T>, callback: (item: T, index: number) => K) => Map<K, T[]>;
      }
    ).groupBy;
    const byLength = mapGroupBy(['a', 'bb', 'c'], (item) => item.length);
    expect(byLength.get(1)).toEqual(['a', 'c']);
    expect(byLength.get(2)).toEqual(['bb']);
  });
});

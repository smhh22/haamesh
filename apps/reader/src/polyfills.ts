/**
 * Android WebViews on older devices (and Chrome < 117) lack the grouping
 * helpers that foliate-js uses while parsing EPUB metadata. Install a small
 * spec-compatible subset before any book code runs.
 */
const objectGroupBy = <T>(
  items: Iterable<T>,
  callback: (item: T, index: number) => PropertyKey,
): Record<PropertyKey, T[]> => {
  const result: Record<PropertyKey, T[]> = Object.create(null);
  let index = 0;
  for (const item of items) {
    const key = callback(item, index);
    index += 1;
    const group = result[key];
    if (group) group.push(item);
    else result[key] = [item];
  }
  return result;
};

const mapGroupBy = <T, K>(
  items: Iterable<T>,
  callback: (item: T, index: number) => K,
): Map<K, T[]> => {
  const result = new Map<K, T[]>();
  let index = 0;
  for (const item of items) {
    const key = callback(item, index);
    index += 1;
    const group = result.get(key);
    if (group) group.push(item);
    else result.set(key, [item]);
  }
  return result;
};

const objectTarget = Object as typeof Object & { groupBy?: typeof objectGroupBy };
const mapTarget = Map as typeof Map & { groupBy?: typeof mapGroupBy };

if (typeof objectTarget.groupBy !== 'function') objectTarget.groupBy = objectGroupBy;
if (typeof mapTarget.groupBy !== 'function') mapTarget.groupBy = mapGroupBy;

export {};

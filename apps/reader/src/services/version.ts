/** Numeric semver comparison, tolerant of a leading `v` and pre-release tags. */
export const isNewerVersion = (candidate: string, installed: string): boolean => {
  const parse = (value: string): number[] =>
    value
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);

  const next = parse(candidate);
  const current = parse(installed);
  for (let index = 0; index < 3; index += 1) {
    const difference = (next[index] ?? 0) - (current[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
};

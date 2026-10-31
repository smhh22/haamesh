/**
 * Builds the release body from squash-merge subjects between two tags.
 * Used by the release workflow; runnable locally:
 *   node scripts/release-notes.mjs v0.5.0 v0.6.0
 * Prints markdown to stdout and exits non-zero without a tag pair.
 */
const [from, to] = process.argv.slice(2);

if (!from || !to) {
  console.error('usage: release-notes.mjs <previous-tag> <new-tag>');
  process.exit(2);
}

const { execFileSync } = await import('node:child_process');

const log = execFileSync('git', ['log', '--pretty=format:%s', `${from}..${to}`], {
  encoding: 'utf8',
}).trim();

// Internal work (chore/ci/docs/test/build/style) is not user-facing; keep it
// out of the notes and the updater hover preview.
const INTERNAL = /^(chore|ci|docs|test|build|style)(\(.+\))?!?:/i;

const subjects = (log ? log.split('\n').filter(Boolean) : []).filter(
  (subject) => !INTERNAL.test(subject),
);

const FEATURES = /^feat(\(.+\))?!?:/i;
const FIXES = /^fix(\(.+\))?!?:/i;
const PERFORMANCE = /^perf(\(.+\))?!?:/i;

const clean = (subject) => subject.replace(/^[a-z]+(\(.+\))?!?:\s*/i, '');
const bullet = (subject) => `- ${clean(subject).replace(/\s+\(#\d+\)$/, '')}`;

const features = subjects.filter((s) => FEATURES.test(s) && !FIXES.test(s));
const fixes = subjects.filter((s) => FIXES.test(s));
const performance = subjects.filter((s) => PERFORMANCE.test(s));
const others = subjects.filter((s) => !FEATURES.test(s) && !FIXES.test(s) && !PERFORMANCE.test(s));

const sections = [];
if (features.length) sections.push(`## Changes\n${features.map(bullet).join('\n')}`);
if (fixes.length) sections.push(`## Fixes\n${fixes.map(bullet).join('\n')}`);
if (performance.length) sections.push(`## Performance\n${performance.map(bullet).join('\n')}`);
if (others.length) sections.push(`## Other\n${others.map(bullet).join('\n')}`);

const header = `Local-first ebook reader with first-class RTL support. Installers and the signed Android APK are attached.`;
process.stdout.write(`${[header, ...sections].join('\n\n')}\n`);

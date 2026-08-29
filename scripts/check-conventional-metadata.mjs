import { execFileSync } from 'node:child_process';

const TYPES = [
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test',
];

const typeAlternation = TYPES.join('|');
const conventionalSubject = new RegExp(
  `^(${typeAlternation})(\\([a-z0-9][a-z0-9._/-]*\\))?!?: \\S.*$`,
);

function validate(label, subject, failures) {
  if (conventionalSubject.test(subject)) return;
  failures.push(`${label}: ${JSON.stringify(subject)}`);
}

const prTitle = process.env.PR_TITLE?.trim();
const baseSha = process.env.BASE_SHA?.trim();
const headSha = process.env.HEAD_SHA?.trim();

if (!prTitle || !baseSha || !headSha) {
  throw new TypeError('PR_TITLE, BASE_SHA, and HEAD_SHA are required');
}

const failures = [];
validate('PR title', prTitle, failures);

const commitSubjects = execFileSync(
  'git',
  ['log', '--format=%s', `${baseSha}..${headSha}`],
  { encoding: 'utf8' },
)
  .split('\n')
  .map((subject) => subject.trim())
  .filter(Boolean);

for (const subject of commitSubjects) validate('Commit subject', subject, failures);

if (failures.length > 0) {
  console.error('Conventional metadata check failed.');
  console.error('Expected: <type>(optional-scope): description');
  console.error(`Allowed types: ${TYPES.join(', ')}`);
  console.error('Examples:');
  console.error('  feat(web): add mechanism index page');
  console.error('  fix(renderer-svg): increase responsive stroke weight');
  console.error('  chore(ci): enforce conventional metadata');
  console.error('');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`PR title and ${commitSubjects.length} commit subject(s) are conventional.`);

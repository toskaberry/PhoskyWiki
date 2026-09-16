import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyRelease } from './release-gate.mjs';

const sha = 'a'.repeat(40);
const imageId = `sha256:${'b'.repeat(64)}`;
const image = `ghcr.io/raime7/phoskywiki@sha256:${'c'.repeat(64)}`;
const evidence = () => ({
  repository: 'raime7/PhoskyWiki', sha, runId: '123',
  run: { id: 123, head_sha: sha, head_branch: 'main', event: 'push', path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success', run_attempt: 1, repository: { full_name: 'raime7/PhoskyWiki' }, head_repository: { full_name: 'raime7/PhoskyWiki' } },
  jobs: ['lint + typecheck + vitest', 'playwright + container', 'release-ready'].map(name => ({ name, head_sha: sha, status: 'completed', conclusion: 'success' })),
  receipt: { sha, runId: '123', attempt: 1, image, imageId },
});
test('a successful exact main commit qualifies its tested immutable image', () => {
  assert.equal(qualifyRelease(evidence()).image, image);
});

test('repository rename drift is actionable and still refuses the release', () => {
  const input = evidence();
  input.run.repository.full_name = 'toskaberry/PhoskyWiki';
  input.run.head_repository.full_name = 'toskaberry/PhoskyWiki';
  assert.throws(() => qualifyRelease(input), /RELEASE_NOT_QUALIFIED:REPOSITORY_MISMATCH/);
});

for (const [name, change] of [
  ['another commit', e => { e.run.head_sha = 'd'.repeat(40); }],
  ['a PR run', e => { e.run.event = 'pull_request'; }],
  ['another repository', e => { e.run.head_repository.full_name = 'attacker/fork'; }],
  ['another workflow', e => { e.run.path = '.github/workflows/monitor.yml'; }],
  ['failed checks', e => { e.jobs[0].conclusion = 'failure'; }],
  ['skipped browser checks', e => { e.jobs[1].conclusion = 'skipped'; }],
  ['missing checks', e => { e.jobs.pop(); }],
  ['duplicate job names', e => { e.jobs.push(e.jobs[0]); }],
  ['old attempt receipt', e => { e.run.run_attempt = 2; }],
  ['foreign registry', e => { e.receipt.image = image.replace('raime7', 'attacker'); }],
  ['mutable tag', e => { e.receipt.image = 'ghcr.io/raime7/phoskywiki:latest'; }],
  ['unfinished run', e => { e.run.status = 'in_progress'; }],
]) test(`rejects ${name}`, () => {
  const input = evidence(); change(input);
  assert.throws(() => qualifyRelease(input), /RELEASE_NOT_QUALIFIED/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseRefusal } from './release.mjs';

test('refusal reports distinguish repository transfer drift without exposing arbitrary error text', () => {
  assert.deepEqual(releaseRefusal(new Error('RELEASE_NOT_QUALIFIED:REPOSITORY_MISMATCH'), 'qualification'), {
    result: 'refused', phase: 'qualification', error: 'RELEASE_NOT_QUALIFIED:REPOSITORY_MISMATCH', migration: 'not-started',
  });
  for (const message of ['token=private-value', 'RELEASE_NOT_QUALIFIED:REPOSITORY_MISMATCH\nprivate-value', 'RELEASE_FAILED: private-value']) {
    const record = releaseRefusal(new Error(message), 'deployment');
    assert.equal(record.error, 'RELEASE_FAILED');
    assert.equal(record.migration, 'unknown');
    assert.ok(!JSON.stringify(record).includes('private-value'));
  }
});

test('the host CLI emits a nonempty failed receipt and never echoes a malformed request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phosky-refusal-test-'));
  try {
    const config = join(directory, 'release.json');
    await writeFile(config, '{}', { mode: 0o600 });
    const child = spawnSync(process.execPath, [new URL('./release.mjs', import.meta.url).pathname, config], {
      input: '{"githubToken":"private-value",broken', encoding: 'utf8',
    });
    assert.equal(child.status, 1);
    assert.deepEqual(JSON.parse(child.stdout), {
      result: 'refused', phase: 'request', error: 'RELEASE_FAILED', migration: 'not-started',
    });
    assert.match(child.stderr, /RELEASE_REFUSED/);
    assert.ok(!(child.stdout + child.stderr).includes('private-value'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

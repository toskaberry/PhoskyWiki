import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
export function qualifyRelease({ repository, sha, runId, run, jobs, receipt }) {
  const reject = (reason = 'EVIDENCE_MISMATCH') => { throw new Error(`RELEASE_NOT_QUALIFIED:${reason}`); };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(sha) || !/^[1-9][0-9]*$/.test(String(runId))) reject();
  if (run.repository?.full_name !== repository || run.head_repository?.full_name !== repository) reject('REPOSITORY_MISMATCH');
  if (String(run.id) !== String(runId) || run.head_sha !== sha || run.head_branch !== 'main' || run.event !== 'push' || run.path !== '.github/workflows/ci.yml' || run.status !== 'completed' || run.conclusion !== 'success') reject('RUN_MISMATCH');
  for (const name of ['lint + typecheck + vitest', 'playwright + container', 'release-ready']) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length !== 1 || matches[0].head_sha !== sha || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') reject('JOBS_MISMATCH');
  }
  const prefix = `ghcr.io/${repository.toLowerCase()}@`;
  if (receipt.sha !== sha || String(receipt.runId) !== String(runId) || receipt.attempt !== run.run_attempt || !receipt.image?.startsWith(prefix) || !/^sha256:[a-f0-9]{64}$/.test(receipt.image.slice(prefix.length)) || !/^sha256:[a-f0-9]{64}$/.test(receipt.imageId)) reject('RECEIPT_MISMATCH');
  return receipt;
}

// Fetch evidence from GitHub, never from caller-supplied files or image tags.
export async function fetchQualifiedRelease(repository, runId, sha, token) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[1-9][0-9]*$/.test(String(runId)) || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('RELEASE_INPUT_INVALID');
  const env = { ...process.env, GH_HOST: 'github.com', ...(token ? { GH_TOKEN: token } : {}) };
  const api = async path => {
    try { return JSON.parse((await exec('gh', ['api', path], { env, maxBuffer: 4 * 1024 * 1024, timeout: 60_000 })).stdout); }
    catch { throw new Error('RELEASE_EVIDENCE_FETCH_FAILED'); }
  };
  const run = await api(`repos/${repository}/actions/runs/${runId}`);
  // Attempt-specific jobs prevent old successful reruns from qualifying a failure.
  const result = await api(`repos/${repository}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`);
  if (result.total_count > 100) throw new Error('RELEASE_JOBS_OVERFLOW');
  const directory = await mkdtemp(join(tmpdir(), 'phosky-release-'));
  try {
    let receipt;
    try {
      await exec('gh', ['run', 'download', String(runId), '--repo', repository, '--name', `release-${run.run_attempt}`, '--dir', directory], { env, timeout: 60_000 });
      receipt = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8'));
    } catch { throw new Error('RELEASE_ARTIFACT_UNAVAILABLE'); }
    return qualifyRelease({ repository, runId, sha, run, jobs: result.jobs, receipt });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  fetchQualifiedRelease(...process.argv.slice(2)).then(receipt => console.log(JSON.stringify(receipt))).catch(() => { console.error('RELEASE_NOT_QUALIFIED: inspect the exact CI run and artifact'); process.exitCode = 1; });
}

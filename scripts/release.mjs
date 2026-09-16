// Root-owned host entrypoint. SSH supplies only the small JSON request on stdin.
// Configuration and Compose files are installed by an operator, never over SSH.
import { execFile, spawn } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { readFile, writeFile, mkdir, open, unlink, rename, stat, statfs, chown, chmod, mkdtemp, rm } from 'node:fs/promises';
import { totalmem, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchQualifiedRelease } from './release-gate.mjs';
import { verifyMigrationHistory, verifyMigrationLedger } from './release-migrations.mjs';

const exec = promisify(execFile);
const immutable = value => typeof value === 'string' && /^([a-z0-9.:/_-]+@)?sha256:[a-f0-9]{64}$/.test(value);
const fail = code => { throw new Error(code); };
// Classic Docker reports the config digest as Id; containerd reports the
// manifest digest. A pinned registry manifest still binds the exact CI config.
export function verifyImageReceipt(receipt, image, manifest) {
  const digest = receipt.image.split('@')[1];
  const containerd = digest && image.Id === digest && image.Descriptor?.digest === digest
    && manifest?.schemaVersion === 2
    && ['application/vnd.docker.distribution.manifest.v2+json', 'application/vnd.oci.image.manifest.v1+json'].includes(manifest.mediaType)
    && !manifest.manifests && manifest.config?.digest === receipt.imageId;
  if ((image.Id !== receipt.imageId && !containerd) || image.Config?.Labels?.['org.opencontainers.image.revision'] !== receipt.sha) fail('IMAGE_RECEIPT_MISMATCH');
}
async function privateJSON(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size > 65536 || (process.platform !== 'win32' && (info.mode & 0o077))) fail('PROTECTED_CONFIG_REQUIRED');
  return JSON.parse(await readFile(path, 'utf8'));
}
async function atomic(path, value) {
  const existing = await stat(path).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  await writeFile(`${path}.tmp`, value, { mode: 0o600 });
  if (existing && process.platform !== 'win32') {
    await chown(`${path}.tmp`, existing.uid, existing.gid);
    await chmod(`${path}.tmp`, existing.mode & 0o777);
  }
  await rename(`${path}.tmp`, path);
}

export async function deployRelease(config, receipt, request, credentials) {
  if (request.environment !== config.environment || !request.notice?.trim() || request.notice.length > 500 || receipt.sha !== request.sha || !immutable(receipt.image) || !immutable(receipt.imageId)) fail('RELEASE_TARGET_OR_INPUT_INVALID');
  await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
  const lockPath = join(config.stateDir, 'release.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); } catch { fail('RELEASE_LOCKED: inspect previous evidence before clearing stale lock'); }
  const record = { startedAt: new Date().toISOString(), environment: config.environment, notice: request.notice, next: receipt, phase: 'preflight', migration: 'not-started', result: 'running' };
  const recordPath = join(config.stateDir, `release-${Date.now()}.json`);
  let maintenanceStarted;
  let retainLock = false;
  let dockerConfig;
  const save = () => atomic(recordPath, JSON.stringify(record, null, 2));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('COMPOSE_') && !key.startsWith('DOCKER_')));
  const deployment = await readFile(config.envFile, 'utf8').catch(() => '');
  // Parse data; never source shell code. Unknown values stay out of Docker's env.
  for (const line of deployment.split(/\r?\n/)) {
    const match = /^(APP_IMAGE|BACKUP_IMAGE|SECRETS_DIR|ORIGIN_PORT)=(.*)$/.exec(line);
    if (match) env[match[1]] = match[2];
  }
  const command = async (file, args, timeout = 120_000) => {
    try { return (await exec(file, args, { env, cwd: config.directory, timeout, maxBuffer: 4 * 1024 * 1024 })).stdout.trim(); }
    catch { fail('RELEASE_COMMAND_FAILED'); } // Never emit subprocess output with runtime credentials.
  };
  const compose = args => command('docker', ['compose', '--project-name', config.project, '--env-file', config.envFile, ...config.composeFiles.flatMap(file => ['-f', file]), ...args]);
  const ops = (action, image) => {
    env.APP_IMAGE = image;
    return compose(['run', '--rm', '-T', '--no-deps', 'ops', action, '--target', config.target]);
  };
  const inspect = async image => JSON.parse(await command('docker', ['image', 'inspect', image]))[0];
  const schema = async image => JSON.parse(await command('docker', ['run', '--rm', '--network', 'none', '--entrypoint', 'node', image, '-e', "const fs=require('fs'),c=require('crypto');const hash=n=>c.createHash('sha256').update(fs.readFileSync('drizzle/'+n)).digest('hex');const journal=JSON.parse(fs.readFileSync('drizzle/meta/_journal.json'));console.log(JSON.stringify({journal,files:Object.fromEntries(fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort().map(n=>[n,hash(n)]))}));" ]));
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, recordPath }));
    await save();
    if (!immutable(env.APP_IMAGE) || !immutable(env.BACKUP_IMAGE) || !env.SECRETS_DIR) fail('PINNED_RUNTIME_REQUIRED');
    const runtime = await privateJSON(join(env.SECRETS_DIR, 'runtime.json'));
    const db = new URL(runtime.DATABASE_URL);
    const actualTarget = `${db.hostname}:${db.port || '5432'}/${decodeURIComponent(db.pathname.slice(1))}/${decodeURIComponent(db.username)}`;
    if (actualTarget !== config.target || runtime.PHOSKYWIKI_ENV !== config.environment) fail('TARGET_MISMATCH');
    const disk = await statfs(config.directory);
    if (disk.bavail * disk.bsize < (config.minDiskBytes ?? 3 * 1024 ** 3) || totalmem() < (config.minMemoryBytes ?? 1800 * 1024 ** 2)) fail('INSUFFICIENT_RESOURCES');
    const old = env.APP_IMAGE;
    const running = await compose(['ps', '-q', 'app']);
    if (!running || running.includes('\n')) fail('RUNNING_APP_REQUIRED');
    const actual = JSON.parse(await command('docker', ['inspect', running]))[0];
    const previous = await inspect(old);
    if (actual.Image !== previous.Id || actual.State.Health?.Status !== 'healthy') fail('RUNNING_IMAGE_MISMATCH');
    record.previous = { image: old, imageId: previous.Id, sha: previous.Config.Labels?.['org.opencontainers.image.revision'] };
    const backupPath = join(env.SECRETS_DIR, 'backup-config.json');
    const backup = await privateJSON(backupPath);
    if (backup.appRevision !== record.previous.sha || backup.databaseUrl !== runtime.DATABASE_URL || backup.backup?.bucket !== config.bucket || backup.source?.bucket !== runtime.R2_BUCKET || backup.source?.endpoint !== runtime.R2_ENDPOINT || !isDeepStrictEqual(backup.runtime, runtime)) fail('BACKUP_TARGET_OR_REVISION_MISMATCH');
    await stat(join(env.SECRETS_DIR, 'backup-encryption.key'));
    if (credentials) {
      if (!credentials.token || !/^[a-zA-Z0-9_[\]-]+$/.test(credentials.user || '')) fail('REGISTRY_CREDENTIALS_REQUIRED');
      dockerConfig = await mkdtemp(join(tmpdir(), 'phosky-release-auth-'));
      env.DOCKER_CONFIG = dockerConfig;
      // A per-run config avoids overwriting persistent host Docker credentials.
      // The token travels on stdin, never command arguments or release records.
      await new Promise((resolve, reject) => {
        const child = spawn('docker', ['login', 'ghcr.io', '--username', credentials.user, '--password-stdin'], { env, stdio: ['pipe', 'ignore', 'ignore'] });
        const timeout = setTimeout(() => { child.kill(); reject(new Error('REGISTRY_LOGIN_TIMEOUT')); }, 30_000);
        child.on('error', () => { clearTimeout(timeout); reject(new Error('REGISTRY_LOGIN_FAILED')); });
        child.on('exit', code => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error('REGISTRY_LOGIN_FAILED')); });
        child.stdin.on('error', () => {});
        child.stdin.end(credentials.token);
      });
    }
    // Registry digest is checked against the exact tested configuration ID.
    if (receipt.image.includes('@')) await command('docker', ['pull', receipt.image], 300_000);
    const next = await inspect(receipt.image);
    const manifest = next.Id !== receipt.imageId && receipt.image.includes('@')
      ? JSON.parse(await command('docker', ['manifest', 'inspect', receipt.image])) : undefined;
    verifyImageReceipt(receipt, next, manifest);
    const before = await schema(old), after = await schema(receipt.image);
    record.rollbackCompatible = verifyMigrationHistory(before, after);
    env.APP_IMAGE = old;
    const applied = JSON.parse(await compose(['run', '--rm', '-T', '--no-deps', '--entrypoint', 'node', 'ops', '-e', "const fs=require('fs'),{Pool}=require('pg');const p=new Pool({connectionString:JSON.parse(fs.readFileSync('/run/secrets/runtime.json')).DATABASE_URL});p.query('SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at').then(r=>console.log(JSON.stringify(r.rows))).finally(()=>p.end());"]));
    verifyMigrationLedger(before, applied);
    await ops('verify', receipt.image);
    // Pin and download all images before stopping writers.
    await inspect(env.BACKUP_IMAGE);
    const free = await statfs(config.directory);
    if (free.bavail * free.bsize < (config.minDiskBytes ?? 3 * 1024 ** 3)) fail('INSUFFICIENT_RESOURCES');
    record.phase = 'stopping'; await save();
    maintenanceStarted = Date.now();
    record.maintenanceStartedAt = new Date(maintenanceStarted).toISOString();
    await compose(['stop', 'app']);
    record.phase = 'backup'; await save();
    const backupArgs = ['--config', '/run/secrets/backup-config.json', '--key-file', '/run/secrets/backup-encryption.key', '--target', config.target, '--bucket', config.bucket];
    const runBackup = async args => {
      const output = await command('docker', ['compose', '--project-name', config.project, '--env-file', config.envFile, ...config.composeFiles.flatMap(file => ['-f', file]), '--profile', 'backup', 'run', '--rm', '-T', '--no-deps', 'backup', ...args], config.backupTimeoutMs ?? 240_000);
      const result = JSON.parse(output.split('\n').at(-1));
      if (result.ok !== true) fail('BACKUP_FAILED');
      return result;
    };
    const created = await runBackup(['create', ...backupArgs]);
    if (!/^[a-f0-9-]{36}$/.test(created.point)) fail('BACKUP_POINT_INVALID');
    const verified = await runBackup(['verify', ...backupArgs, '--point', created.point]);
    if (verified.point !== created.point) fail('BACKUP_POINT_MISMATCH');
    record.recoveryPoint = created.point;
    if (Date.now() - maintenanceStarted > 360_000) fail('MAINTENANCE_BUDGET_EXCEEDED');
    record.phase = 'migrating'; record.migration = 'in-progress'; await save();
    await ops('migrate', receipt.image);
    record.migration = 'succeeded'; record.phase = 'switching'; await save();
    env.APP_IMAGE = receipt.image;
    await compose(['up', '-d', '--no-deps', '--wait', '--wait-timeout', '90', 'app']);
    // Check both app and origin. The origin proxy was never replaced.
    const response = await fetch(config.healthUrl, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok) fail('ORIGIN_UNHEALTHY');
    record.phase = 'persisting'; await save();
    await atomic(config.envFile, deployment.replace(/^APP_IMAGE=.*$/m, `APP_IMAGE=${receipt.image}`));
    backup.appRevision = receipt.sha;
    await atomic(backupPath, JSON.stringify(backup));
    record.result = 'succeeded'; record.phase = 'complete';
  } catch (error) {
    record.error = /^[A-Z_]+(?::.*)?$/.test(error.message) ? error.message : 'RELEASE_FAILED';
    record.result = 'failed';
    if (maintenanceStarted) {
      // A possibly partial migration or persistence failure must not restart an
      // unproven application. Preserve the lock for controlled operator recovery.
      if (record.migration === 'not-started' || (record.migration === 'succeeded' && record.rollbackCompatible && record.phase === 'switching')) {
        try {
          env.APP_IMAGE = record.previous.image;
          await compose(['up', '-d', '--no-deps', '--wait', '--wait-timeout', '90', 'app']);
          const response = await fetch(config.healthUrl, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
          if (!response.ok) fail('FALLBACK_UNHEALTHY');
          record.result = 'failed-old-app-restored';
        } catch { record.result = 'manual-recovery-required'; retainLock = true; }
      } else {
        await compose(['stop', 'app']).catch(() => {});
        record.result = 'manual-recovery-required'; retainLock = true;
      }
    }
  } finally {
    if (dockerConfig) await rm(dockerConfig, { recursive: true, force: true });
    record.finishedAt = new Date().toISOString();
    if (maintenanceStarted) {
      record.maintenanceSeconds = Math.ceil((Date.now() - maintenanceStarted) / 1000);
      record.maintenanceTargetMet = !retainLock && record.maintenanceSeconds <= 600;
    }
    await save();
    await lock.close();
    if (!retainLock) await unlink(lockPath);
  }
  return record;
}

// Only fixed, reviewed codes may cross the host boundary. Never serialize an
// arbitrary Error, subprocess stderr, request, configuration, or token.
export function releaseRefusal(error, phase) {
  const allowed = new Set([
    'PROTECTED_CONFIG_REQUIRED', 'REQUEST_TOO_LARGE', 'TEMPORARY_GITHUB_TOKEN_REQUIRED',
    'RELEASE_INPUT_INVALID', 'RELEASE_JOBS_OVERFLOW', 'RELEASE_EVIDENCE_FETCH_FAILED',
    'RELEASE_ARTIFACT_UNAVAILABLE', 'RELEASE_TARGET_OR_INPUT_INVALID',
    'RELEASE_NOT_QUALIFIED:EVIDENCE_MISMATCH', 'RELEASE_NOT_QUALIFIED:REPOSITORY_MISMATCH',
    'RELEASE_NOT_QUALIFIED:RUN_MISMATCH', 'RELEASE_NOT_QUALIFIED:JOBS_MISMATCH',
    'RELEASE_NOT_QUALIFIED:RECEIPT_MISMATCH',
  ]);
  const code = error?.message?.startsWith('RELEASE_LOCKED:') ? 'RELEASE_LOCKED'
    : allowed.has(error?.message) ? error.message : 'RELEASE_FAILED';
  return { result: 'refused', phase, error: code, migration: phase === 'deployment' ? 'unknown' : 'not-started' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let phase = 'configuration';
  try {
    const config = await privateJSON(process.argv[2] || '/etc/phoskywiki/release.json');
    phase = 'request';
    let input = '';
    for await (const chunk of process.stdin) { input += chunk; if (input.length > 4096) fail('REQUEST_TOO_LARGE'); }
    const { githubToken, registryUser, ...request } = JSON.parse(input);
    if (typeof githubToken !== 'string' || githubToken.length < 20 || githubToken.length > 1024) fail('TEMPORARY_GITHUB_TOKEN_REQUIRED');
    phase = 'qualification';
    const receipt = await fetchQualifiedRelease(config.repository, request.runId, request.sha, githubToken);
    phase = 'deployment';
    const record = await deployRelease(config, receipt, request, { token: githubToken, user: registryUser });
    console.log(JSON.stringify(record));
    if (record.result !== 'succeeded') process.exitCode = 1;
  } catch (error) {
    const refusal = releaseRefusal(error, phase);
    console.log(JSON.stringify(refusal));
    console.error(`RELEASE_REFUSED: ${refusal.error} (${phase}); inspect protected host records and exact CI run`);
    process.exitCode = 1;
  }
}

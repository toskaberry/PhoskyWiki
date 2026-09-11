// Real Docker + PostgreSQL + Meilisearch + production HTTP/browser acceptance.
// Creates a random Compose project and private volume; never loads .env or R2.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { chromium } from "@playwright/test";

const project = `phosky-d01-test-${randomBytes(5).toString("hex")}`;
const directory = await mkdtemp(join(tmpdir(), project));
const secretVolume = `${project}_secrets`;
const imageTag = `${project}:test`;
const secrets = [randomBytes(24).toString("hex"), randomBytes(24).toString("hex"), randomBytes(24).toString("hex")];
const releaseSettings = process.env.RELEASE_CONTRACT_CONFIG ? JSON.parse(await readFile(process.env.RELEASE_CONTRACT_CONFIG, 'utf8')) : null;
if (releaseSettings) {
  assert(releaseSettings.bucket.endsWith('-test'), 'Release drills require a dedicated test bucket');
  secrets.push(releaseSettings.accessKeyId, releaseSettings.secretAccessKey);
}
const admins = [
  { name: "首位管理员", email: "first@example.com", password: randomBytes(24).toString("hex") },
  { name: "第二位管理员", email: "second@example.com", password: randomBytes(24).toString("hex") },
];
secrets.push(...admins.map(admin => admin.password));
const env = { ...process.env, SECRETS_DIR: directory, APP_IMAGE: imageTag };
// Do not inherit Compose file/project/remote daemon overrides.
for (const key of Object.keys(env)) if (key.startsWith("COMPOSE_")) delete env[key];
const redact = text => secrets.reduce((safe, secret) => safe.replaceAll(secret, "[redacted]"), text);

async function exec(file, args, input, quiet = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { output += data; });
    child.on("error", reject);
    child.on("close", code => {
      if (!quiet || code) console.log(redact(output));
      if (code) reject(new Error(`${file} ${args[0]} exited ${code}`));
      else resolve(output.trim());
    });
    child.stdin.end(input);
  });
}
const override = join(directory, "compose.yml");
const composeArgs = ["compose", "--project-name", project, "--env-file", join(directory, "empty.env"), "-f", resolve("compose.production.yml"), ...(releaseSettings ? ['-f', resolve('compose.backup.yml')] : []), "-f", override];
const compose = (args, input, quiet) => exec("docker", [...composeArgs, ...args], input, quiet);
const target = "postgres:5432/phoskywiki_test/phosky";
async function ops(...args) {
  const output = await compose(["run", "--rm", "--no-deps", "ops", ...args, "--target", target]);
  const summary = output.split("\n").find(line => line.startsWith('{"ok":true'));
  if (summary) report.opsPeakRssBytes = Math.max(report.opsPeakRssBytes || 0, JSON.parse(summary).peakRssBytes);
  return output;
}
let browser;
let createdVolume = false;
let createdProject = false;
const report = { project, startedAt: new Date().toISOString(), passed: false, memory: {}, limitations: ["Local Docker resource observations do not establish capacity on the 1 vCPU / 2 GB Vultr instance.", "Image metadata fixture only; no real R2 image bytes or public domain tested."] };

async function recordMemory() {
  for (const service of ["app", "postgres", "meilisearch", "proxy"]) {
    const id = await compose(["ps", "-q", service], undefined, true);
    const peak = Number(await exec("docker", ["exec", id, "cat", "/sys/fs/cgroup/memory.peak"], undefined, true));
    report.memory[service] = {
      cgroupPeakBytes: Math.max(report.memory[service]?.cgroupPeakBytes || 0, peak),
      limitBytes: Number(await exec("docker", ["inspect", id, "--format", "{{.HostConfig.Memory}}"], undefined, true)),
      oomKilled: (await exec("docker", ["inspect", id, "--format", "{{.State.OOMKilled}}"], undefined, true)) === "true",
    };
    assert.equal(report.memory[service].oomKilled, false);
  }
}

try {
  await exec("docker", ["info", "--format", "{{.ServerVersion}}"], undefined, true);
  const revision = await exec("git", ["rev-parse", "HEAD"], undefined, true);
  report.revision = revision;
  report.dirty = Boolean(await exec("git", ["status", "--porcelain", "--untracked-files=no"], undefined, true));
  if (!process.env.TEST_APP_IMAGE) {
    console.log("Building production image without runtime secrets or database access…");
    await exec("docker", ["build", "--build-arg", `APP_REVISION=${revision}`, "--tag", imageTag, "."]);
  }
  env.APP_IMAGE = await exec("docker", ["image", "inspect", process.env.TEST_APP_IMAGE || imageTag, "--format", "{{.Id}}"], undefined, true);
  assert.equal(await exec("docker", ["image", "inspect", env.APP_IMAGE, "--format", '{{index .Config.Labels "org.opencontainers.image.revision"}}'], undefined, true), revision);
  report.image = env.APP_IMAGE;
  if (releaseSettings) env.BACKUP_IMAGE = await exec('docker', ['image', 'inspect', process.env.TEST_BACKUP_IMAGE, '--format', '{{.Id}}'], undefined, true);
  const port = await new Promise((resolve, reject) => {
    const listener = createServer();
    listener.on("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close(() => resolve(address.port));
    });
  });
  const origin = `http://localhost:${port}`;
  await writeFile(join(directory, "empty.env"), "");
  await writeFile(override, `services:
  postgres:
    environment: { POSTGRES_DB: phoskywiki_test }
    volumes: !override ["pgdata:/var/lib/postgresql", "test_secrets:/run/secrets:ro"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U phosky -d phoskywiki_test"]
  meilisearch:
    volumes: !override ["meili_data:/meili_data", "test_secrets:/run/secrets:ro"]
  app:
    volumes: !override ["test_secrets:/run/secrets:ro"]
  ops:
    volumes: !override ["test_secrets:/run/secrets:ro"]
  proxy:
    ports: !override ["127.0.0.1:${port}:8080"]
${releaseSettings ? '  backup:\n    volumes: !override ["test_secrets:/run/secrets:ro"]\n' : ''}
volumes:
  test_secrets:
    external: true
    name: ${secretVolume}
`);
  await exec("docker", ["volume", "create", secretVolume], undefined, true);
  createdVolume = true;
  async function writeSecrets(origin) {
    const runtime = {
      DATABASE_URL: `postgres://phosky:${secrets[0]}@postgres:5432/phoskywiki_test`,
      BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: secrets[1],
      MEILI_HOST: "http://meilisearch:7700", MEILI_MASTER_KEY: secrets[2], MEILI_INDEX_UID: "pages-test",
      R2_ENDPOINT: "https://isolated-d01.invalid", R2_BUCKET: "phosky-d01-test", R2_ACCESS_KEY_ID: "isolated", R2_SECRET_ACCESS_KEY: "isolated-not-real",
      PHOSKYWIKI_ENV: releaseSettings ? 'test' : 'production',
    };
    if (releaseSettings) Object.assign(runtime, { R2_ENDPOINT: releaseSettings.endpoint, R2_BUCKET: releaseSettings.bucket, R2_ACCESS_KEY_ID: releaseSettings.accessKeyId, R2_SECRET_ACCESS_KEY: releaseSettings.secretAccessKey });
    const files = { "runtime.json": JSON.stringify(runtime), "admins.json": JSON.stringify(admins), "postgres-password": secrets[0], "meili-key": secrets[2] };
    if (releaseSettings) {
      files['backup-config.json'] = JSON.stringify({ databaseUrl: runtime.DATABASE_URL, appRevision: revision, runtime, source: releaseSettings, backup: { ...releaseSettings, prefix: `d04/${project}/` } });
      files['backup-encryption.key'] = randomBytes(24).toString('base64');
      for (const [name, value] of Object.entries(files)) await writeFile(join(directory, name), value, { mode: 0o600 });
    }
    await exec("docker", ["run", "--rm", "-i", "--user", "0:0", "--entrypoint", "node", "-v", `${secretVolume}:/secrets`, env.APP_IMAGE, "-e", "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const fs=require('node:fs');for(const [name,value] of Object.entries(JSON.parse(s))){const p='/secrets/'+name;fs.writeFileSync(p,value,{mode:0o600});fs.chownSync(p,1000,1000)}})"], JSON.stringify(files), true);
  }
  await writeSecrets(origin);
  createdProject = true;
  await compose(["up", "-d", "--wait", "postgres", "meilisearch"]);
  await assert.rejects(() => compose(["run", "--rm", "--no-deps", "ops", "migrate", "--target", "production:5432/wrong/phosky"]));
  await ops("migrate");
  await ops("bootstrap", "--credentials", "/run/secrets/admins.json");
  await Promise.all([ops("bootstrap", "--credentials", "/run/secrets/admins.json"), ops("bootstrap", "--credentials", "/run/secrets/admins.json")]);
  await compose(["up", "-d", "--wait", "app", "proxy"]);
  const binding = await compose(["port", "proxy", "8080"], undefined, true);
  assert.equal(binding, `127.0.0.1:${port}`);
  const imageEnv = await exec("docker", ["image", "inspect", env.APP_IMAGE, "--format", "{{json .Config.Env}}"], undefined, true);
  for (const secret of secrets) assert(!imageEnv.includes(secret));
  for (const service of ["postgres", "meilisearch", "app"]) {
    const id = await compose(["ps", "-q", service], undefined, true);
    const bindings = JSON.parse(await exec("docker", ["inspect", id, "--format", "{{json .HostConfig.PortBindings}}"], undefined, true));
    assert(!bindings || Object.keys(bindings).length === 0, `${service} must not publish host ports`);
  }
  browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const page = await browser.newPage();
  const failures = [];
  page.on("pageerror", error => failures.push(error.message));
  async function login(admin) {
    await page.context().clearCookies();
    await page.goto(`${origin}/login`);
    await page.getByLabel("邮箱").fill(admin.email);
    await page.getByLabel("密码").fill(admin.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByTestId("session-user").filter({ hasText: "管理员" }).waitFor();
  }
  await login(admins[0]);
  const title = "生产首条词条";
  const summary = "生产容器中创建的第一个导航词条。";
  const created = await page.request.post(`${origin}/api/submissions`, { data: { kind: "new_term", title, summary } });
  assert.equal(created.status(), 201);
  const term = await created.json();
  assert.equal(term.outcome, "direct");
  await page.goto(`${origin}${term.href}`);
  assert((await page.locator("body").innerText()).includes(summary));
  const historyURL = `${origin}/api/pages/${term.pageId}/history`;
  const initialHistory = await (await page.request.get(historyURL)).json();
  assert.equal(initialHistory.revisions[0].source, "create");
  const edit = await page.request.post(`${origin}/api/submissions`, { data: {
    kind: "edit", pageId: term.pageId, baseRevisionId: initialHistory.revisions[0].id,
    title, summary: "管理员直编后的简介", aliases: [], keyTexts: [],
  } });
  assert.equal(edit.status(), 201);
  assert.equal((await edit.json()).outcome, "direct");
  const history = await (await page.request.get(historyURL)).json();
  assert.equal(history.revisions[0].source, "direct");
  assert.equal(history.revisions.length, 2);
  assert.equal(history.revisions[0].snapshot.summary, "管理员直编后的简介");
  // Metadata comes through the real upload API; no object network request is
  // needed to sign an upload. Bytes/CORS belong to the real R2 acceptance.
  const upload = await page.request.post(`${origin}/api/images`, { data: { filename: "persistent.png", contentType: "image/png", size: 68 } });
  assert.equal(upload.status(), 201);
  const image = await upload.json();
  assert.match(image.id, /^[\w-]+$/);
  const sql = `SELECT id, filename, size, uploaded_by, staging_key FROM images WHERE id='${image.id}';`;
  const metadata = await compose(["exec", "-T", "postgres", "psql", "-U", "phosky", "-d", "phoskywiki_test", "-Atc", sql], undefined, true);
  assert(metadata.includes("persistent.png"));
  await ops("reindex", "--search", "http://meilisearch:7700/pages-test");
  const search = await page.request.get(`${origin}/api/search?q=${encodeURIComponent(title)}`);
  assert.equal(search.status(), 200);
  assert((await search.text()).includes(title));
  await ops("bootstrap", "--credentials", "/run/secrets/admins.json");
  await recordMemory();
  for (const action of [["restart", "app"], ["up", "-d", "--force-recreate", "--no-deps", "app"]]) {
    await compose(action);
    await compose(["up", "-d", "--wait", "app", "proxy"]);
    for (const admin of admins) await login(admin);
    await page.goto(`${origin}${term.href}`);
    assert((await page.locator("body").innerText()).includes("管理员直编后的简介"));
    assert.deepEqual(await (await page.request.get(historyURL)).json(), history);
    assert.equal(await compose(["exec", "-T", "postgres", "psql", "-U", "phosky", "-d", "phoskywiki_test", "-Atc", sql], undefined, true), metadata);
    assert.equal((await page.request.get(`${origin}/healthz`)).status(), 200);
    await recordMemory();
  }
  await login(admins[0]);
  const current = await (await page.request.get(`${origin}/api/auth/get-session`)).json();
  const promoteArgs = ["promote-first-superadmin", "--environment", releaseSettings ? "test" : "production", "--user-id", current.user.id, "--name", admins[0].name];
  await ops(...promoteArgs);
  await ops(...promoteArgs);
  await ops("bootstrap", "--credentials", "/run/secrets/admins.json");
  await page.goto(`${origin}/profile`);
  assert((await page.getByTestId("session-user").innerText()).includes("超级管理员"));
  assert.equal((await page.request.get(`${origin}/api/admin/users`)).status(), 200);
  report.superadminBootstrap = true;
  assert.deepEqual(failures, []);
  if (releaseSettings) {
    const { runReleaseScenarios } = await import('./test-release-scenarios.mjs');
    report.release = await runReleaseScenarios({ directory, project, env, override, origin, revision, page, term, compose, exec, releaseSettings });
  }
  report.passed = true;
} finally {
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  await mkdir("artifacts/operations", { recursive: true });
  await writeFile("artifacts/operations/d01-containers.json", JSON.stringify(report, null, 2));
  // All cleanup names were generated above; no inherited project or volume.
  if (createdProject) await compose(["down", "--volumes", "--remove-orphans"]).catch(() => {});
  if (createdVolume) await exec("docker", ["volume", "rm", secretVolume], undefined, true).catch(() => {});
  await rm(directory, { recursive: true, force: true });
}

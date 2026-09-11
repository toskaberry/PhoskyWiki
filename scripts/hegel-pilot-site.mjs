/** Local pilot operator: DB reads only; every content write uses the HTTP submission API. */
import "dotenv/config";
import pg from "pg";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

const mode = process.argv[2];
if (!["inventory", "apply", "check"].includes(mode)) throw Error("Usage: hegel-pilot-site.mjs inventory|apply|check");
const root = resolve("artifacts/content-pilots/hegel-quality");
mkdirSync(root, { recursive: true });
const base = "http://localhost:3000";
const target = new URL(process.env.DATABASE_URL);
if (target.hostname !== "localhost" || (target.port || "5432") !== "5432" || target.pathname !== "/phoskywiki" || target.search) {
  throw Error("Pilot requires the agreed localhost:5432/phoskywiki target");
}
if (new URL(process.env.BETTER_AUTH_URL).origin !== base) throw Error("Unexpected site origin");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
let cookie = "";
const hash = value => createHash("sha256").update(value).digest("hex");
const save = (name, data) => writeFileSync(join(root, name), JSON.stringify(data, null, 2) + "\n");
const ledgerPath = join(root, "write-ledger.jsonl");
const ledger = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
const record = row => { ledger.push(row); appendFileSync(ledgerPath, JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n"); };

async function request(path, body) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET", redirect: "error",
    headers: { "Content-Type": "application/json", Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw Error(`HTTP ${response.status} ${path}; inspect site and ledger before retry`);
  return response;
}

async function inventory() {
  const identity = (await db.query("select current_database() as database")).rows[0];
  if (identity.database !== "phoskywiki") throw Error("Database identity mismatch");
  const rows = (await db.query(`select p.id,p.type,p.title,p.slug,p.deleted_at,t.aliases,t.summary,
    v.term_id,v.interpreter_id,r.id as revision_id,r.content,r.snapshot
    from pages p left join terms t on t.page_id=p.id
    left join perspectives v on v.page_id=p.id
    left join lateral (select id,content,snapshot from revisions where page_id=p.id order by created_at desc,id desc limit 1) r on true
    order by p.id`)).rows;
  return { target: "localhost:5432/phoskywiki", identity, rows };
}

async function submit(input) {
  // Stay below the default 60 writes/account/minute limit.
  await new Promise(r => setTimeout(r, 1100));
  if (typeof input.content === "string") input.content = input.content.trim();
  const operationId = randomUUID();
  record({ kind: "intent", operationId, input });
  const result = await (await request("/api/submissions", input)).json();
  if (result.outcome !== "direct") throw Error("Expected administrator direct publication; stop for review");
  const history = await (await request(`/api/pages/${result.pageId}/history`)).json();
  record({ operationId, pageId: result.pageId, href: result.href, kind: input.kind,
    beforeRevisionId: input.baseRevisionId || null, afterRevisionId: history.revisions[0].id,
    contentHash: input.content ? hash(input.content) : null });
  return { ...result, revisionId: history.revisions[0].id };
}

async function publishPerspective(c, termId, interpreterId, content) {
  content = content.trim();
  const current = (await inventory()).rows.filter(p => p.type === "perspective" && p.term_id === termId && p.interpreter_id === interpreterId);
  if (current.length > 1 || current[0]?.deleted_at) throw Error(`Hidden or ambiguous perspective: ${c.title}`);
  if (current.length === 0) {
    const created = await submit({ kind: "new_perspective", termId, interpreterId, content });
    return { ...created, expectedContent: content };
  }
  const p = current[0];
  // An exact suffix also covers a lost HTTP response after an append succeeded.
  if (p.content === content || p.content?.endsWith("\n\n" + content)) {
    await reconcile(p, `/perspective/${p.slug}-${p.id}`);
    return { pageId: p.id, href: `/perspective/${p.slug}-${p.id}`, expectedContent: p.content };
  }
  const previous = [...ledger].reverse().find(r => r.pageId === p.id && r.contentHash);
  if (previous && previous.afterRevisionId === p.revision_id &&
      [hash(p.content), hash(p.content + "\n")].includes(previous.contentHash)) {
    // Replace only this operator's unchanged pilot material, retaining the pre-pilot text.
    const firstWrite = ledger.find(r => r.pageId === p.id && r.contentHash);
    let original = "";
    if (firstWrite.beforeRevisionId) {
      const history = await (await request(`/api/pages/${p.id}/history`)).json();
      const baseline = history.revisions.find(r => r.id === firstWrite.beforeRevisionId);
      if (!baseline) throw Error(`Pre-pilot revision unavailable: ${c.title}`);
      original = baseline.content || "";
    }
    const combined = original ? original.trimEnd() + "\n\n" + content : content;
    const result = await submit({ kind: "edit", pageId: p.id, baseRevisionId: p.revision_id, content: combined });
    return { ...result, expectedContent: combined };
  }
  if (previous || p.content?.includes("## 资料覆盖范围")) {
    throw Error(`Existing pilot content differs; reconcile revisions before editing: ${c.title}`);
  }
  const combined = (p.content || "").trimEnd() + "\n\n" + content;
  const result = await submit({ kind: "edit", pageId: p.id, baseRevisionId: p.revision_id, content: combined });
  return { ...result, expectedContent: combined };
}

async function reconcile(page, href) {
  const completed = new Set(ledger.filter(r => r.pageId).map(r => r.operationId));
  const intent = [...ledger].reverse().find(r => r.kind === "intent" && !completed.has(r.operationId) &&
    ((r.input.kind === "new_term" && r.input.title === page.title) ||
     (r.input.kind === "new_perspective" && r.input.termId === page.term_id && r.input.interpreterId === page.interpreter_id && r.input.content === page.content) ||
     (r.input.kind === "edit" && r.input.pageId === page.id && r.input.content === page.content)));
  if (!intent) return;
  const history = await (await request(`/api/pages/${page.id}/history`)).json();
  record({ kind: "reconciled", operationId: intent.operationId, pageId: page.id, href,
    beforeRevisionId: intent.input.baseRevisionId || null, afterRevisionId: history.revisions[0].id,
    contentHash: intent.input.content ? hash(intent.input.content) : null });
}

try {
  await db.connect();
  await db.query("SET default_transaction_read_only = on");
  const initial = await inventory();
  const payloads = JSON.parse(readFileSync(join(root, "payloads.json"), "utf8"));
  if (mode === "inventory") {
    save("inventory.json", initial);
    const titles = new Set(payloads.flatMap(c => [c.title, ...c.aliases]));
    console.log(JSON.stringify({ pages: initial.rows.length, terms: initial.rows.filter(p => p.type === "term").length,
      existingMatches: initial.rows.filter(p => p.type === "term" && titles.has(p.title)).map(p => ({ id: p.id, title: p.title })),
      hegel: initial.rows.filter(p => p.type === "interpreter" && p.title === "黑格尔").map(p => p.id) }));
  } else if (mode === "apply") {
    const verified = spawnSync(process.env.PYTHON || "python", ["scripts/hegel-pilot.py", "verify", "--plan", "docs/reports/hegel-quality-concepts.json", "--output", root], { encoding: "utf8" });
    if (verified.status !== 0) throw Error("Source verification failed; run the verifier for details");
    if (!existsSync(join(root, "before.dump"))) {
      const backup = spawnSync("docker", ["exec", "phoskywiki-postgres", "pg_dump", "-U", target.username, "-d", "phoskywiki", "-Fc"], { maxBuffer: 128 * 1024 * 1024 });
      if (backup.status !== 0 || !backup.stdout?.length) throw Error("Pre-write backup failed");
      writeFileSync(join(root, "before.dump"), backup.stdout);
      save("before-snapshot.json", initial);
      save("backup.json", { target: initial.target, sha256: hash(backup.stdout), bytes: backup.stdout.length, at: new Date().toISOString() });
    }
    if (!process.env.SEED_ADMIN_EMAIL || !process.env.SEED_ADMIN_PASSWORD) throw Error("Existing administrator credentials unavailable");
    const login = await request("/api/auth/sign-in/email", { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD });
    cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    const session = await (await request("/api/auth/get-session")).json();
    if (session?.user?.role !== "admin") throw Error("Authenticated user is not an administrator");
    // Check that HTTP and the read-only inventory see the same pre-existing page.
    const probe = initial.rows.find(p => !p.deleted_at);
    const visible = await (await request(`/api/pages/${probe.id}/history`)).json();
    if (visible.page.title !== probe.title || visible.revisions[0]?.id !== probe.revision_id) throw Error("Site and database inventory differ");
    const hegel = initial.rows.filter(p => p.type === "interpreter" && p.title === "黑格尔" && !p.deleted_at);
    if (hegel.length !== 1) throw Error("Expected one existing Hegel interpreter");
    const termIds = new Map();
    for (const c of payloads) {
      const rows = (await inventory()).rows;
      const matches = rows.filter(p => p.type === "term" && (p.title === c.title || c.aliases.includes(p.title) || p.aliases?.includes(c.title)));
      if (matches.length > 1 || matches[0]?.deleted_at) throw Error(`Ambiguous/hidden term: ${c.title}`);
      if (matches.length) {
        await reconcile(matches[0], `/term/${matches[0].slug}-${matches[0].id}`);
        termIds.set(c.key, matches[0].id);
      } else {
        const created = await submit({ kind: "new_term", title: c.title, aliases: c.aliases,
          summary: c.status === "mention" ? "《小逻辑》A．质中提及的概念；视角待补。" : c.intro });
        termIds.set(c.key, created.pageId);
      }
    }
    const review = [];
    for (const c of payloads) {
      const termId = termIds.get(c.key);
      const row = (await inventory()).rows.find(p => p.id === termId);
      const item = { key: c.key, title: c.title, status: c.status, termId, termHref: `/term/${row.slug}-${termId}` };
      if (c.status === "substantive") {
        item.hegel = await publishPerspective(c, termId, hegel[0].id, c.content);
      }
      review.push(item);
      save("review-index.json", review);
      console.log(JSON.stringify({ title: c.title, status: c.status }));
    }
    writeFileSync(join(root, "review-index.md"), "# 《小逻辑》A．质试点评阅\n\n逐篇评阅尚待用户完成。\n\n" + review.map(c =>
      `- [${c.title}](${base}${c.termHref})${c.hegel ? ` · [黑格尔视角](${base}${c.hegel.href})` : " · 仅概念页"}`).join("\n") + "\n");
    save("after-inventory.json", await inventory());
  } else {
    const review = JSON.parse(readFileSync(join(root, "review-index.json"), "utf8"));
    if (review.length !== payloads.length) throw Error("Pilot page inventory is incomplete");
    let perspectives = 0;
    for (const item of review) {
      const page = await request(item.termHref);
      if (!(await page.text()).includes(item.title)) throw Error(`Term missing: ${item.title}`);
      for (const view of [item.hegel].filter(Boolean)) {
        const history = await (await request(`/api/pages/${view.pageId}/history`)).json();
        if (history.revisions[0].content !== view.expectedContent) throw Error(`Stored content differs: ${item.title}`);
        await request(view.href);
        perspectives++;
      }
    }
    save("site-verification.json", { terms: review.length, perspectives, storedTextMatches: true, humanReview: "pending", at: new Date().toISOString() });
    console.log(JSON.stringify({ terms: review.length, perspectives, storedTextMatches: true }));
  }
} finally {
  await db.end();
}

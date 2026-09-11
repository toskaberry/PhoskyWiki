import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const script = resolve("scripts/hegel-pilot.py");
const python = process.env.PYTHON || "python";

test("EPUB extraction preserves continued supplements, emphasis and linked translator notes", () => {
  const dir = mkdtempSync(join(tmpdir(), "hegel-pilot-"));
  try {
    const epub = join(dir, "source.epub");
    const fixture = `<html xmlns="http://www.w3.org/1999/xhtml"><body>
      <h3 id="quality">A．质</h3><p>§ 86</p>
      <p>纯有是<span class="point">直接性</span>。</p>
      <p><span class="bold">附释：</span>第一段。</p>
      <p>继续论述<a id="ref" href="#note">[33]</a>。</p>
      <p>§ 99</p><p>不在范围内。</p>
      <p><a id="note" href="#ref">[1]</a>译注内容。——译者注</p>
    </body></html>`;
    const zip = spawnSync(python, ["-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('text/part0009_split_002.html',sys.stdin.buffer.read()); z.close()", epub], { input: fixture, encoding: "utf8" });
    assert.equal(zip.status, 0, zip.stderr);
    const run = spawnSync(python, [script, "extract", epub, "--output", dir], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const rows = readFileSync(join(dir, "paragraphs.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(rows.map(p => [p.section, p.layer, p.text]), [
      [86, "正文", "纯有是直接性。"],
      [86, "附释", "附释：第一段。"],
      [86, "附释", "继续论述[33]。"],
    ]);
    assert.equal(rows[0].markdown, "纯有是<!-- -->**直接性**<!-- -->。");
    const rendered = spawnSync(process.execPath, ["--import=tsx", "--input-type=module", "-e",
      'import {renderMarkdown} from "./src/lib/markdown.ts"; console.log(renderMarkdown(process.argv[1],()=>({href:"",exists:false})))', rows[1].markdown], { encoding: "utf8" });
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.equal(rendered.stdout.trim(), "<p><strong>附释：</strong>第一段。</p>");
    const notes = JSON.parse(readFileSync(join(dir, "notes.json"), "utf8"));
    assert.equal(rows[2].notes[0], "note");
    assert.equal(notes.note.text, "[1]译注内容。——译者注");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("build uses original paragraphs and verification rejects a modified quotation", () => {
  const dir = mkdtempSync(join(tmpdir(), "hegel-build-"));
  try {
    const epub = join(dir, "source.epub");
    const fixture = '<html><body><p>§ 86</p><p>原文<span class="point">强调</span>。</p><p>§ 99</p></body></html>';
    spawnSync(python, ["-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('text/part0009_split_002.html',sys.stdin.buffer.read()); z.close()", epub], { input: fixture });
    const run = (...args) => spawnSync(python, [script, ...args, "--output", dir], { encoding: "utf8" });
    assert.equal(run("extract", epub).status, 0);
    const manifest = JSON.parse(readFileSync(join(dir, "source-manifest.json"), "utf8"));
    const plan = join(dir, "plan.json");
    writeFileSync(plan, JSON.stringify({ sourceSha256: manifest.epubSha256, concepts: [
      { key: "c01", title: "概念", aliases: [], status: "substantive", intro: "引文外说明。", paragraphs: ["s86-p01"], pendingReferences: ["§82及说明（只记录，不扩摘）"] },
      { key: "c02", title: "仅提及", aliases: [], status: "mention", intro: "", paragraphs: ["s86-p01"] },
    ] }));
    const built = run("build", "--plan", plan);
    assert.equal(built.status, 0, built.stderr);
    const payloads = JSON.parse(readFileSync(join(dir, "payloads.json"), "utf8"));
    assert.match(payloads[0].content, /> 原文<!-- -->\*\*强调\*\*<!-- -->。/);
    assert.match(payloads[0].content, /§82及说明（只记录，不扩摘）/);
    assert.equal(payloads[1].content, "");
    assert.equal(payloads.some(payload => "boardContent" in payload), false);
    assert.equal(run("verify", "--plan", plan).status, 0);
    const draft = join(dir, "drafts", "c01.md");
    writeFileSync(draft, readFileSync(draft, "utf8").replace("原文<!-- -->**强调**<!-- -->。", "原文已改。"));
    const checked = run("verify", "--plan", plan);
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /Draft differs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("inline concept links preserve source wording, emphasis and alias destinations", () => {
  const dir = mkdtempSync(join(tmpdir(), "hegel-links-"));
  try {
    const epub = join(dir, "source.epub");
    const original = "变易是有与无的统一。没有一般的说法；规定在这里；纯有不是定在。绝对确定性。";
    const fixture = '<html><body><p>§ 86</p><p>变易是<span class="point">有</span>与无的统一。没有一般的说法；规定在这里；纯有不是定在。<span class="point">绝对</span>确定性。</p><p>§ 99</p></body></html>';
    spawnSync(python, ["-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('text/part0009_split_002.html',sys.stdin.buffer.read()); z.close()", epub], { input: fixture });
    const run = (...args) => spawnSync(python, [script, ...args, "--output", dir], { encoding: "utf8" });
    assert.equal(run("extract", epub).status, 0);
    const manifest = JSON.parse(readFileSync(join(dir, "source-manifest.json"), "utf8"));
    const plan = join(dir, "plan.json");
    writeFileSync(plan, JSON.stringify({ sourceSha256: manifest.epubSha256,
      inlineLinkExclusions: ["规定在", "绝对确定性"].map(phrase => ({ phrase, paragraphs: ["s86-p01"], reason: "不拆分词语" })), concepts:
      ["变易", "存在", "无", "一", "纯有", "定在", "绝对"].map((title, i) => ({ key: `c${i}`, title,
        aliases: title === "存在" ? ["有"] : [], status: i === 0 ? "substantive" : "mention",
        intro: "变易是有与无的统一。", paragraphs: ["s86-p01"] })) }));
    assert.equal(run("build", "--plan", plan).status, 0);
    const content = JSON.parse(readFileSync(join(dir, "payloads.json"), "utf8"))[0].content;
    const quote = content.split("\n").find(line => line.startsWith("> ")).slice(2);
    assert.match(quote, /\[\[存在\|有\]\]/);
    assert.match(quote, /\[\[无\]\]/);
    assert.match(quote, /没有一般/);
    assert.match(quote, /规定在这里/);
    assert.match(quote, /不是\[\[定在\]\]/);
    assert.match(quote, /\[\[纯有\]\]/);
    assert.doesNotMatch(quote, /\[\[一\]\]/);
    assert.doesNotMatch(quote, /\[\[绝对\]\]/);
    const rendered = spawnSync(process.execPath, ["--import=tsx", "--input-type=module", "-e",
      'import {renderMarkdown,renderMarkdownText} from "./src/lib/markdown.ts";const resolve=r=>({href:"/term/"+r.term,exists:true});console.log(JSON.stringify({text:renderMarkdownText(process.argv[1],resolve),html:renderMarkdown(process.argv[1],resolve)}))', quote], { encoding: "utf8" });
    assert.equal(rendered.status, 0, rendered.stderr);
    const result = JSON.parse(rendered.stdout);
    assert.equal(result.text, original);
    assert.match(result.html, /<strong><a[^>]*href="\/term\/存在"[^>]*>有<\/a><\/strong>/);
    assert.equal(run("verify", "--plan", plan).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

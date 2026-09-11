"""Source extraction for the Shorter Logic pilot. Standard library only."""

import argparse
from collections import defaultdict
from contextlib import redirect_stdout
import hashlib
import io
import json
from pathlib import Path
import re
from tempfile import TemporaryDirectory
import xml.etree.ElementTree as ET
from zipfile import ZipFile

MEMBER = "text/part0009_split_002.html"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalize(text):
    return re.sub(r"\s+", " ", text).strip()


def markdown_text(text):
    return re.sub(r"([\\`*_\[\]<>])", r"\\\1", text or "")


def inline(element):
    result = markdown_text(element.text)
    for child in element:
        value = inline(child)
        if set(child.get("class", "").split()) & {"point", "bold"}:
            # Invisible inline boundaries let CommonMark retain punctuation-ending
            # emphasis before Chinese text. Never start a paragraph with HTML.
            value = ("<!-- -->" if result.strip() else "") + "**" + value + "**<!-- -->"
        result += value + markdown_text(child.tail)
    return result


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_rows(path, rows):
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def extract(epub, output):
    epub = Path(epub)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    with ZipFile(epub) as archive:
        source = archive.read(MEMBER)
    root = ET.fromstring(source)
    parents = {child: parent for parent in root.iter() for child in parent}
    anchors = {e.get("id"): e for e in root.iter() if e.get("id")}
    paragraphs, notes, log = [], {}, []
    counts = defaultdict(int)
    section, layer, anchor = None, "正文", None
    for element in root.iter():
        tag = element.tag.rsplit("}", 1)[-1]
        if tag in ("h2", "h3", "div") and element.get("id"):
            anchor = element.get("id")
        if tag != "p":
            continue
        raw = "".join(element.itertext())
        text = normalize(raw)
        match = re.fullmatch(r"§\s*(\d+)", text)
        if match:
            section, layer = int(match[1]), "正文"
            continue
        if section is None or not 84 <= section <= 98 or not text:
            continue
        if text.startswith("〔说明〕"):
            layer = "说明"
        supplement = re.match(r"附释([一二三四五六七八九十]*)[：:]", text)
        if supplement:
            layer = "附释" + supplement[1]
        counts[section] += 1
        pid = f"s{section}-p{counts[section]:02}"
        refs = []
        for link in element.iter():
            href = link.get("href", "")
            if "#" not in href:
                continue
            target = href.split("#", 1)[1]
            candidate = anchors.get(target)
            if candidate is None:
                raise ValueError(f"Unresolved source reference: {pid}/{target}")
            while candidate.tag.rsplit("}", 1)[-1] != "p":
                candidate = parents[candidate]
            note_text = normalize("".join(candidate.itertext()))
            if "译者注" not in note_text:
                raise ValueError(f"Unclassified source reference: {pid}/{target}")
            notes[target] = {"text": note_text, "markdown": normalize(inline(candidate)),
                             "xml": ET.tostring(candidate, encoding="unicode")}
            refs.append(target)
        paragraphs.append({"id": pid, "section": section, "layer": layer,
                           "anchor": anchor, "background": section < 86,
                           "text": text, "markdown": normalize(inline(element)),
                           "notes": refs, "rawText": raw,
                           "textSha256": digest(text.encode()),
                           "xml": ET.tostring(element, encoding="unicode")})
        if raw != text:
            log.append({"id": pid, "rule": "collapse whitespace and trim paragraph boundary",
                        "before": raw, "after": text})
    if not paragraphs:
        raise ValueError("Source range is empty")
    (output / "source.xhtml").write_bytes(source)
    write_json(output / "source-manifest.json", {"epubSha256": digest(epub.read_bytes()),
               "member": MEMBER, "memberSha256": digest(source), "range": [86, 98],
               "optionalBackground": [84, 85], "paragraphs": len(paragraphs)})
    write_rows(output / "paragraphs.jsonl", paragraphs)
    write_json(output / "notes.json", notes)
    write_rows(output / "normalization-log.jsonl", log)
    (output / "source-reading.md").write_text("\n\n".join(
        f"## {p['id']} / {p['layer']}\n\n{p['text']}" for p in paragraphs), encoding="utf-8")
    print(json.dumps({"paragraphs": len(paragraphs), "notes": len(notes)}))


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def read_rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def link_concepts(markdown, concepts, current_key, paragraph_id=None, exclusions=()):
    """Add navigation without changing the source's visible words or formatting."""
    names = {}
    for concept in concepts:
        for name in [concept["title"], *concept["aliases"]]:
            if name in names and names[name]["key"] != concept["key"]:
                raise ValueError(f"Ambiguous inline concept: {name}")
            names[name] = concept
    # Match longer names even when ineligible, so 自为存在 never links only 存在.
    protected = {item["phrase"] for item in exclusions if paragraph_id in item["paragraphs"]}
    separator = r"(?:<!--.*?-->|\*\*)*"
    alternatives = "|".join(
        separator.join(re.escape(char) for char in name) if name in protected else re.escape(name)
        for name in sorted(set(names) | protected, key=lambda n: (-len(n), n)))
    pattern = re.compile(r"<!--.*?-->|\\.|\*\*|" + alternatives)
    linked = set()

    def replace(match):
        word = match[0]
        if re.sub(r"<!--.*?-->|\*\*", "", word) in protected:
            return word
        concept = names.get(word)
        if not concept or concept["key"] == current_key or concept["key"] in linked:
            return word
        if paragraph_id is not None and paragraph_id not in concept["paragraphs"]:
            return word
        if len(word) == 1:
            before, after = markdown[:match.start()], markdown[match.end():]
            emphasized = before.endswith("**") and after.startswith("**")
            before = re.sub(r"<!--.*?-->|\*\*", "", before)
            after = re.sub(r"<!--.*?-->|\*\*", "", after)
            quoted = before.endswith(("“", "「", "『")) and after.startswith(("”", "」", "』"))
            pair = word in "有无" and (re.search(r"[有无](?:[与和即或、]|即是)$", before) or
                                      re.match(r"(?:[与和即或、]|即是)[有无]", after))
            if not (emphasized or quoted or pair):
                return word
        linked.add(concept["key"])
        target = concept["title"]
        return f"[[{target}]]" if word == target else f"[[{target}|{word}]]"

    return pattern.sub(replace, markdown)


def load_source(output, plan):
    manifest = read_json(output / "source-manifest.json")
    source = (output / "source.xhtml").read_bytes()
    if manifest["epubSha256"] != plan["sourceSha256"] or digest(source) != manifest["memberSha256"]:
        raise ValueError("Source identity mismatch")
    # Re-parse the frozen source, independently of the editable paragraph inventory.
    with TemporaryDirectory(prefix="hegel-verify-") as directory:
        root = Path(directory)
        with ZipFile(root / "source.epub", "w") as archive:
            archive.writestr(MEMBER, source)
        with redirect_stdout(io.StringIO()):
            extract(root / "source.epub", root)
        paragraphs, notes = read_rows(root / "paragraphs.jsonl"), read_json(root / "notes.json")
        if paragraphs != read_rows(output / "paragraphs.jsonl") or notes != read_json(output / "notes.json"):
            raise ValueError("Extracted text or source attribution differs from frozen source")
    return paragraphs, notes


def compose(output, plan):
    paragraphs, notes = load_source(output, plan)
    by_id = {p["id"]: p for p in paragraphs}
    coverage = {p["id"]: {"id": p["id"], "excerptFor": [], "mentionedFor": []} for p in paragraphs}
    concepts = plan["concepts"]
    for field in ("key", "title"):
        if len({c[field] for c in concepts}) != len(concepts):
            raise ValueError(f"Duplicate concept {field}")
    payloads = []
    for c in concepts:
        if not re.fullmatch(r"c\d+", c["key"]):
            raise ValueError("Unsafe concept key")
        ids = c["paragraphs"]
        if not ids or len(ids) != len(set(ids)) or any(pid not in by_id for pid in ids):
            raise ValueError(f"Invalid paragraph selection: {c['title']}")
        if c["status"] not in ("substantive", "mention"):
            raise ValueError("Unknown concept status")
        selected = [p for p in paragraphs if p["id"] in ids]
        field = "excerptFor" if c["status"] == "substantive" else "mentionedFor"
        for p in selected:
            coverage[p["id"]][field].append(c["key"])
        content = ""
        if c["status"] == "substantive":
            scope = "《小逻辑》（黑格尔，贺麟译），第一篇存在论 A．质，§86—98。"
            if any(p["background"] for p in selected):
                scope += "另补入标明的 §84—85 总引背景。"
            scope += "本页仅整理这一资料范围，不代表黑格尔对本概念的全部论述。"
            intro = link_concepts(c["intro"], concepts, c["key"])
            chunks = ["## 资料覆盖范围\n\n" + scope,
                      "## 导语（编者整理）\n\n" + intro, "## 原文摘录"]
            for p in selected:
                background = " · 章外背景" if p["background"] else ""
                excerpt = link_concepts(p["markdown"], concepts, c["key"], p["id"], plan.get("inlineLinkExclusions", []))
                chunks.append(f"### §{p['section']} · {p['layer']} · {p['id']}{background}\n\n> {excerpt}")
                chunks.append(f"出处：《小逻辑》，黑格尔著，贺麟译；§{p['section']}，{p['layer']}，原段 {p['id']}。")
                for nid in p["notes"]:
                    chunks.append(f"译注（对应本段原书链接，保留原显示注号）：\n\n> {notes[nid]['markdown']}")
            related = [other["title"] for other in concepts if other["key"] != c["key"]
                       and set(ids) & set(other["paragraphs"])]
            chunks.append("## 关联概念\n\n" + "、".join(f"[[{title}]]" for title in related))
            pending = "\n".join("- " + reference for reference in c.get("pendingReferences", []))
            chunks.append("## 待补与校勘\n\n" + (pending + "\n\n" if pending else "") +
                          "其他章节论述尚待整理。原文疑似错字及异体字符保留；校勘意见须与引文分开。")
            content = "\n\n".join(chunks) + "\n"
        payloads.append({**c, "content": content})
    for row in coverage.values():
        if not row["excerptFor"]:
            row["reason"] = "仅提及概念，保留定位待补视角" if row["mentionedFor"] else "未选作必要章外背景"
            if not row["mentionedFor"] and not by_id[row["id"]]["background"]:
                raise ValueError(f"Unreviewed core paragraph: {row['id']}")
        else:
            row["reason"] = "定义、论证、反驳、例子或必要过渡；具体归属见 excerptFor，待用户逐篇评阅"
    return payloads, list(coverage.values())


def build(output, plan_path, verify=False):
    output = Path(output)
    plan = read_json(Path(plan_path))
    payloads, coverage = compose(output, plan)
    drafts = output / "drafts"
    if verify:
        if payloads != read_json(output / "payloads.json") or coverage != read_rows(output / "coverage.jsonl"):
            raise ValueError("Payload or coverage differs from source and curation plan")
        for c in payloads:
            if c["status"] == "substantive" and (drafts / (c["key"] + ".md")).read_text(encoding="utf-8") != c["content"]:
                raise ValueError(f"Draft differs from source and curation plan: {c['title']}")
    else:
        drafts.mkdir(exist_ok=True)
        for c in payloads:
            if c["status"] == "substantive":
                (drafts / (c["key"] + ".md")).write_text(c["content"], encoding="utf-8")
        write_json(output / "payloads.json", payloads)
        write_rows(output / "coverage.jsonl", coverage)
    report = {"concepts": len(payloads), "perspectives": sum(c["status"] == "substantive" for c in payloads),
              "paragraphs": len(coverage), "quotationInstances": sum(len(r["excerptFor"]) for r in coverage),
              "sourceAndDraftsVerified": verify, "humanReview": "pending"}
    if verify:
        write_json(output / "verification.json", report)
    print(json.dumps(report))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("extract")
    command.add_argument("epub")
    command.add_argument("--output", required=True)
    for name in ("build", "verify"):
        command = commands.add_parser(name)
        command.add_argument("--plan", required=True)
        command.add_argument("--output", required=True)
    args = parser.parse_args()
    if args.command == "extract":
        extract(args.epub, args.output)
    else:
        build(args.output, args.plan, args.command == "verify")

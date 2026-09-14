import { describe, expect, it } from "vitest";

import { indexPassage, serializeSelection, deserializeSelection, splitSentences, sentencesForRange, relocateAnchor, type PassageNode } from "@/lib/passage-anchors";

const text = (nodeValue: string): PassageNode => ({ nodeType: 3, nodeName: "#text", nodeValue, childNodes: [] });
const element = (nodeName: string, ...childNodes: PassageNode[]): PassageNode => ({ nodeType: 1, nodeName, nodeValue: null, childNodes });

describe("passage sentences", () => {
  it("splits Chinese punctuation and paragraphs, keeping closing quotes with their sentence", () => {
    expect(splitSentences("他说：“好！？”下一句。\n标题\n末段……结束")).toEqual([
      { start: 0, end: 8, text: "他说：“好！？”" },
      { start: 8, end: 12, text: "下一句。" },
      { start: 13, end: 15, text: "标题" },
      { start: 16, end: 20, text: "末段……" },
      { start: 20, end: 22, text: "结束" },
    ]);
  });
  it("keeps mixed terminal punctuation together and preserves a single ellipsis and decimal points", () => {
    expect(splitSentences("好……！”值为3.14，或…未定；继续\r\n结束").map((s) => s.text))
      .toEqual(["好……！”", "值为3.14，或…未定；继续", "结束"]);
    expect(splitSentences(" \n\t")).toEqual([]);
  });
});

describe("passage selections", () => {
  it("round-trips a partial cross-paragraph selection through nested inline nodes and UTF-16 offsets", () => {
    const first = text("甲😀乙。");
    const last = text("丙丁。");
    const root = element("DIV", element("P", first), text("\n"), element("P", element("STRONG", last)));
    const passage = indexPassage(root);
    expect(passage.text).toBe("甲😀乙。\n丙丁。\n");
    const anchor = serializeSelection(passage, { node: first, offset: 1 }, { node: last, offset: 1 }, "r1");
    expect(anchor).toEqual({ start: 1, end: 7, quote: "😀乙。\n丙", baseRevisionId: "r1" });
    const selection = deserializeSelection(passage, anchor!);
    expect(selection).not.toBeNull();
    expect(serializeSelection(passage, selection!.start, selection!.end, "r1")).toEqual(anchor);
  });

  it("includes every intersected sentence, but excludes boundary-only contact", () => {
    const passage = indexPassage(element("DIV", element("P", text("第一句。第二句。")), element("P", text("第三句。"))));
    expect(sentencesForRange(passage, { start: 2, end: 10 }).map((s) => s.text)).toEqual(["第一句。", "第二句。", "第三句。"]);
    expect(sentencesForRange(passage, { start: 2, end: 4 }).map((s) => s.text)).toEqual(["第一句。"]);
    expect(sentencesForRange(passage, { start: 8, end: 9 })).toEqual([]);
  });

  it("accepts element child offsets and backward selections", () => {
    const bold = element("STRONG", text("乙"));
    const p = element("P", text("甲"), bold, text("丙。"));
    const passage = indexPassage(p);
    expect(serializeSelection(passage, { node: p, offset: 2 }, { node: p, offset: 1 }, "r1"))
      .toEqual({ start: 1, end: 2, quote: "乙", baseRevisionId: "r1" });
  });

  it("canonicalizes collapsed whitespace across inline nodes without losing quote offsets", () => {
    const first = text(" 甲\n ");
    const last = text("\t 乙。 ");
    const passage = indexPassage(element("P", first, element("EM", last)));
    expect(passage.text).toBe("甲 乙。 \n");
    const anchor = serializeSelection(passage, { node: first, offset: 1 }, { node: last, offset: 4 }, "r1");
    expect(anchor).toEqual({ start: 0, end: 4, quote: "甲 乙。", baseRevisionId: "r1" });
    const restored = deserializeSelection(passage, anchor!);
    expect(serializeSelection(passage, restored!.start, restored!.end, "r1")).toEqual(anchor);
  });

  it("indexes headings, list items, quotes and code without including image alt text or comments", () => {
    const root = element("DIV",
      element("H2", text("标题")),
      element("UL", element("LI", text("一")), element("LI", text("二"))),
      element("BLOCKQUOTE", element("P", text("引文"))),
      element("P", text("链"), element("A", text("接")), element("BR"), text("后文"), element("IMG")),
      element("PRE", element("CODE", text("x\n  y"))),
      { nodeType: 8, nodeName: "#comment", nodeValue: "隐藏", childNodes: [] },
    );
    expect(indexPassage(root).text).toBe("标题\n一\n二\n引文\n链接\n后文\nx\n  y\n");
  });

  it("rejects foreign, empty, invalid and whitespace-only selections", () => {
    const node = text("甲。 乙。");
    const passage = indexPassage(element("P", node));
    for (const offset of [-1, 0, 0.5, 99, NaN]) {
      expect(serializeSelection(passage, { node, offset: 0 }, { node, offset }, "r1")).toBeNull();
    }
    expect(serializeSelection(passage, { node: text("外部"), offset: 0 }, { node, offset: 2 }, "r1")).toBeNull();
    expect(serializeSelection(passage, { node, offset: 2 }, { node, offset: 3 }, "r1")).toBeNull();
    expect(deserializeSelection(passage, { start: -1, end: 3 })).toBeNull();
  });

  it("rejects whitespace-only selections within a sentence", () => {
    const node = text("甲 乙。");
    const passage = indexPassage(element("P", node));
    expect(serializeSelection(passage, { node, offset: 1 }, { node, offset: 2 }, "r1")).toBeNull();
  });
});

describe("passage relocation", () => {
  it("keeps the exact quote and returns current sentences after surrounding edits", () => {
    const anchor = { baseRevisionId: "r1", start: 4, end: 6, quote: "原句" };
    expect(relocateAnchor(anchor, { revisionId: "r1", text: "序。完整原句。尾。" }, "新序。完整原句。新尾。"))
      .toEqual({ status: "located", range: { start: 5, end: 7 }, sentences: [{ start: 3, end: 8, text: "完整原句。" }] });
  });

  it.each([
    ["unchanged", "序。完整原句。尾。", 4],
    ["prefix insertion", "新增。序。完整原句。尾。", 7],
    ["prefix deletion", "完整原句。尾。", 2],
    ["suffix insertion", "序。完整原句。尾。新增。", 4],
    ["suffix deletion", "序。完整原句。", 4],
    ["emoji prefix", "😀。序。完整原句。尾。", 7],
  ])("locates %s", (_name, current, start) => {
    expect(relocateAnchor({ baseRevisionId: "r1", start: 4, end: 6, quote: "原句" },
      { revisionId: "r1", text: "序。完整原句。尾。" }, current)).toMatchObject({ status: "located", range: { start, end: Number(start) + 2 } });
  });

  it.each([
    ["selected words rewritten", "序。完整新句。尾。"],
    ["unselected part of sentence rewritten", "序。不完整原句。尾。"],
    ["sentence deleted", "序。尾。"],
    ["no match", "完全不同的正文。"],
    ["sentence extended", "序。完整原句补充。尾。"],
    ["sentence merged", "序完整原句。尾。"],
    ["ambiguous duplicate", "序。完整原句。完整原句。尾。"],
    ["diff budget exhausted", "新".repeat(2100) + "。完整原句。" + "后".repeat(2100)],
  ])("marks original changed for %s", (_name, current) => {
    expect(relocateAnchor({ baseRevisionId: "r1", start: 4, end: 6, quote: "原句" },
      { revisionId: "r1", text: "序。完整原句。尾。" }, current)).toEqual({ status: "original-changed" });
  });

  it("does not jump to a surviving duplicate after deleting the original", () => {
    expect(relocateAnchor({ baseRevisionId: "r1", start: 0, end: 2, quote: "同句" },
      { revisionId: "r1", text: "同句。中间。同句。" }, "中间。同句。")).toEqual({ status: "original-changed" });
  });

  it("uses base offsets for repeated text when the body is unchanged", () => {
    expect(relocateAnchor({ baseRevisionId: "r1", start: 3, end: 5, quote: "同句" },
      { revisionId: "r1", text: "同句。同句。" }, "同句。同句。"))
      .toEqual({ status: "located", range: { start: 3, end: 5 }, sentences: [{ start: 3, end: 6, text: "同句。" }] });
  });

  it("relocates a partial selection across paragraphs as one exact quote", () => {
    expect(relocateAnchor({ baseRevisionId: "r1", start: 1, end: 6, quote: "一。\n乙二" },
      { revisionId: "r1", text: "甲一。\n乙二。\n" }, "前。\n甲一。\n乙二。\n"))
      .toEqual({ status: "located", range: { start: 4, end: 9 }, sentences: [
        { start: 3, end: 6, text: "甲一。" }, { start: 7, end: 10, text: "乙二。" },
      ] });
  });

  it("rejects a wrong base revision, corrupt quote or invalid offset", () => {
    const anchor = { baseRevisionId: "r1", start: 0, end: 2, quote: "原句" };
    const base = { revisionId: "r1", text: "原句。" };
    for (const invalid of [{ ...anchor, baseRevisionId: "r2" }, { ...anchor, quote: "错误" }, { ...anchor, end: 99 }, { ...anchor, start: 0.5 }]) {
      expect(relocateAnchor(invalid, base, base.text)).toEqual({ status: "original-changed" });
    }
  });
});

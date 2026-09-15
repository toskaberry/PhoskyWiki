// 服务端锚定投影（lib/passage-body.ts）的规范化文本规则：
// 与客户端对 div.wiki-content 的 indexPassage 同构（docs/passage-anchors.md 契约）。

import { describe, expect, it } from "vitest";

import { renderMarkdown, wikiLinkResolver } from "@/lib/markdown";
import { canonicalMarkdownText, indexMarkdownBody } from "@/lib/passage-body";
import { splitSentences } from "@/lib/passage-anchors";

describe("canonical markdown body projection", () => {
  it("段落、标题、列表逐块换行；行内强调与双链文本保持连续", () => {
    const source = "# 标题一\n\n第一段**加粗**文字。\n\n第二段[[某词条|链接]]结尾。";
    expect(canonicalMarkdownText(source)).toBe("标题一\n第一段加粗文字。\n第二段链接结尾。\n");
  });

  it("双链存在与否不改变规范化文本（红链与实链投影一致）", () => {
    const source = "前文[[主体性]]中段[[异化|他处]]后文";
    const existing = wikiLinkResolver(new Map([
      ["主体性", { href: "/term/x", exists: true }],
      ["异化", { href: "/term/y", exists: true }],
    ]));
    const rendered = renderMarkdown(source, existing);
    expect(rendered).toContain("href=\"/term/x\"");
    expect(canonicalMarkdownText(source)).toBe("前文主体性中段他处后文\n");
  });

  it("列表逐项换行、引用块保留内部段落边界、代码块保空白", () => {
    expect(canonicalMarkdownText("- 一项\n- 二项")).toBe("一项\n二项\n");
    expect(canonicalMarkdownText("> 引用文。")).toBe("引用文。\n");
    expect(canonicalMarkdownText("代码：\n\n```\n  pre  保持\n空格\n```")).toBe("代码：\n  pre  保持\n空格\n");
  });

  it("图片替代文本不贡献偏移，软换行压缩为空格", () => {
    expect(canonicalMarkdownText("![alt 文本](https://x/y.png)不贡献。")).toBe("不贡献。\n");
    expect(canonicalMarkdownText("段内\n软换行合并。")).toBe("段内 软换行合并。\n");
  });

  it("投影索引可做句子聚合（感想工单的按句聚合沿用同一索引）", () => {
    const passage = indexMarkdownBody("第一句。第二句还没有结束？第三句！");
    expect(passage.sentences.map(sentence => sentence.text)).toEqual(["第一句。", "第二句还没有结束？", "第三句！"]);
    expect(splitSentences(passage.text).length).toBe(3);
  });
});

import { describe, expect, it } from "vitest";

import { renderMarkdown, wikiLinkResolver, type ResolveWikiLink } from "@/lib/markdown";

// 典型解析器：已存在的两个词条 + 拉康论主体性视角 + 其余一律红链
const resolve: ResolveWikiLink = (ref) => {
  if (ref.interpreter === null && ref.term === "主体性") {
    return { href: "/term/主体性-1", exists: true };
  }
  if (ref.interpreter === null && ref.term === "异化") {
    return { href: "/term/异化-4", exists: true };
  }
  if (ref.term === "主体性" && ref.interpreter === "拉康") {
    return { href: "/perspective/拉康论主体性-2", exists: true };
  }
  return { href: "", exists: false };
};

describe("renderMarkdown", () => {
  it("默认双链渲染为落词条枢纽的站内链接", () => {
    const html = renderMarkdown("参见 [[主体性]]。", resolve);
    expect(html).toContain(
      '<a class="wiki-link" href="/term/主体性-1">主体性</a>',
    );
  });

  it("未创建词条渲染为红链（span + 提示，无可点击 href）", () => {
    const html = renderMarkdown("缺口见 [[镜像阶段]]。", resolve);
    expect(html).toContain(
      '<span class="wiki-link wiki-link--red" title="词条尚未创建">镜像阶段</span>',
    );
    expect(html).not.toMatch(/href="[^"]*镜像阶段/);
  });

  it("中文词条名与别名显示正常工作", () => {
    const html = renderMarkdown("[[异化]]，或 [[主体性|主体的地位]]。", resolve);
    expect(html).toContain('href="/term/异化-4">异化</a>');
    expect(html).toContain('<a class="wiki-link" href="/term/主体性-1">主体的地位</a>');
  });

  it("显式视角语法渲染为直落视角页的链接，显示 @ 之前的部分", () => {
    const html = renderMarkdown("先读[[主体性|拉康视角@拉康]]。", resolve);
    expect(html).toContain(
      '<a class="wiki-link" href="/perspective/拉康论主体性-2">拉康视角</a>',
    );
    expect(html).not.toContain("@拉康</a>");
  });

  it("显式视角语法未命中渲染为红链（提示视角尚未创建）", () => {
    const html = renderMarkdown(
      "[[主体性|弗洛伊德论主体性@弗洛伊德]]尚待撰写。",
      resolve,
    );
    expect(html).toContain(
      '<span class="wiki-link wiki-link--red" title="视角尚未创建">弗洛伊德论主体性</span>',
    );
    expect(html).not.toMatch(/href="[^"]*perspective/);
  });

  it("基础 Markdown 元素正常渲染", () => {
    const html = renderMarkdown("## 标题\n\n段落**加粗**与 `code`。", resolve);
    expect(html).toContain("<h2>标题</h2>");
    expect(html).toContain("<strong>加粗</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("HTML 直写被 sanitize 剥除（内容只信 Markdown）", () => {
    const html = renderMarkdown(
      '<script>alert(1)</script><img src=x onerror=alert(1)>',
      resolve,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });

  it("链接注入的原始 HTML href 不被渲染为站内链接", () => {
    const html = renderMarkdown(
      '<a href="https://evil.example">钓鱼</a>',
      resolve,
    );
    expect(html).not.toContain("evil.example");
  });
});

describe("wikiLinkResolver", () => {
  it("用 links 表解析结果（键 = 词条名 / 词条@诠释者）构造渲染器回调，未命中为红链", () => {
    const targets = new Map([
      ["异化", { href: "/term/异化-4", exists: true }],
      ["主体性@拉康", { href: "/perspective/拉康论主体性-2", exists: true }],
    ]);
    const resolver = wikiLinkResolver(targets);

    expect(resolver({ term: "异化", interpreter: null })).toEqual({
      href: "/term/异化-4",
      exists: true,
    });
    expect(resolver({ term: "主体性", interpreter: "拉康" })).toEqual({
      href: "/perspective/拉康论主体性-2",
      exists: true,
    });
    expect(resolver({ term: "主体性", interpreter: null })).toEqual({
      href: "",
      exists: false,
    });
    expect(resolver({ term: "主体性", interpreter: "弗洛伊德" })).toEqual({
      href: "",
      exists: false,
    });
  });
});

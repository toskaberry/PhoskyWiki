// 搜索参数解析、高亮转义与 fake 片段契约的纯函数测试（T10）。

import { describe, expect, it } from "vitest";

import { FakeSearchIndex } from "@/lib/search/fake-index";
import {
  SEARCH_TYPES,
  SEARCH_TYPE_LABELS,
  commentDocId,
  highlightHtml,
  parseSearchParams,
  searchHitHref,
} from "@/lib/search/search-types";

describe("parseSearchParams", () => {
  it("默认值与裁剪", () => {
    expect(parseSearchParams({})).toEqual({ q: "", type: null, limit: 20, offset: 0 });
    expect(parseSearchParams({ q: "  异化  " }).q).toBe("异化");
  });

  it("type 白名单：非法值回退为 null（不过滤）", () => {
    expect(parseSearchParams({ type: "term" }).type).toBe("term");
    expect(parseSearchParams({ type: "school" }).type).toBeNull();
    expect(parseSearchParams({ type: "1=1" }).type).toBeNull();
  });

  it("limit/offset 夹取：非数字回默认，越界取边界", () => {
    expect(parseSearchParams({ limit: "abc" }).limit).toBe(20);
    expect(parseSearchParams({ limit: "99" }).limit).toBe(50);
    expect(parseSearchParams({ limit: "0" }).limit).toBe(1);
    expect(parseSearchParams({ offset: "-5" }).offset).toBe(0);
    expect(parseSearchParams({ offset: "40", limit: "10" })).toMatchObject({ limit: 10, offset: 40 });
  });

  it("数组取首值（Next searchParams 的多值形态）", () => {
    expect(parseSearchParams({ q: ["异化", "主体"], type: ["term"] })).toMatchObject({
      q: "异化",
      type: "term",
    });
  });

  it("超长 q 截断", () => {
    expect(parseSearchParams({ q: "长".repeat(300) }).q.length).toBe(200);
  });
});

describe("highlightHtml", () => {
  it("转义原文里的 HTML，只放行 mark 高亮标签", () => {
    const snippet = '<img src=x onerror=alert(1)>异化<mark>劳动</mark>"引号" & 符号';
    const safe = highlightHtml(snippet);
    expect(safe).toContain("<mark>劳动</mark>");
    expect(safe).not.toContain("<img");
    expect(safe).toContain("&lt;img");
    expect(safe).toContain("&quot;引号&quot;");
    expect(safe).toContain("&amp; 符号");
  });

  it("闭合 mark 同样放行", () => {
    expect(highlightHtml("</mark>")).toBe("</mark>");
  });
});

describe("searchHitHref 与标签表", () => {
  it("命中页面按 ADR-0003 寻址；页面评论命中定位到评论区锚点", () => {
    expect(searchHitHref({ type: "term", slug: "yi-hua", pageId: 7 })).toBe("/term/yi-hua-7");
    expect(searchHitHref({ type: "perspective", slug: "p", pageId: 3 })).toBe("/perspective/p-3");
    expect(searchHitHref({ type: "comment", slug: "/perspective/p-3", pageId: commentDocId(9) }))
      .toBe("/perspective/p-3#comment-9");
  });

  it("搜索类型包含页面评论并提供中文标签", () => {
    expect(SEARCH_TYPES).toContain("comment");
    expect(SEARCH_TYPE_LABELS.comment).toBe("页面评论");
    expect(SEARCH_TYPES).not.toContain("discussion");
  });
});

describe("FakeSearchIndex 片段契约（与 Meili 实现同一端口契约）", () => {
  it("片段 HTML 安全：原文转义、无标签放行（fake 无高亮）", async () => {
    const index = new FakeSearchIndex();
    await index.upsert([
      {
        pageId: 1,
        type: "perspective",
        title: "马克思论异化",
        slug: "p",
        body: "<script>alert(1)</script>工人同自己的劳动产品的关系就是异己的关系。",
      },
    ]);
    const { hits } = await index.search("劳动产品");
    expect(hits.length).toBe(1);
    expect(hits[0].snippet).not.toContain("<script>");
    expect(hits[0].snippet).toContain("&lt;script&gt;");
    expect(hits[0].snippet).not.toContain("<mark>");
  });
});

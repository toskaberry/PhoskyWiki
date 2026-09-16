import { describe, expect, it } from "vitest";
import { parseSearchParams, searchHitHref, commentDocId } from "@/lib/search/search-types";

describe("页面评论搜索切换", () => {
  it("旧讨论筛选退役，页面评论链接定位新评论", () => {
    expect(parseSearchParams({ type: "discussion" }).type).toBeNull();
    expect(parseSearchParams({ type: "comment" }).type).toBe("comment");
    expect(searchHitHref({ type: "comment", slug: "/perspective/主体性-12", pageId: commentDocId(34) })).toBe("/perspective/主体性-12#comment-34");
  });
});

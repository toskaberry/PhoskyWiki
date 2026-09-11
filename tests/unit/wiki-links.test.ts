import { describe, expect, it } from "vitest";

import { parseWikiLink, parseWikiLinks, wikiLinkKey } from "@/lib/wiki-links";

describe("parseWikiLink", () => {
  it("默认链接：词条名即显示文本", () => {
    expect(parseWikiLink("主体性", null)).toEqual({
      term: "主体性",
      interpreter: null,
      display: "主体性",
    });
  });

  it("显示别名：落词条枢纽，别名全量显示", () => {
    expect(parseWikiLink("意识形态", "意识形态概念")).toEqual({
      term: "意识形态",
      interpreter: null,
      display: "意识形态概念",
    });
  });

  it("显式视角语法：@ 之后是诠释者名，@ 之前是显示文本", () => {
    expect(parseWikiLink("主体性", "拉康视角@拉康")).toEqual({
      term: "主体性",
      interpreter: "拉康",
      display: "拉康视角",
    });
  });

  it("别名含多个 @ 时取最后一个为诠释者", () => {
    expect(parseWikiLink("主体性", "镜像与误认@精神分析@拉康")).toEqual({
      term: "主体性",
      interpreter: "拉康",
      display: "镜像与误认@精神分析",
    });
  });

  it("@ 之后为空不视为显式视角语法（保持普通别名）", () => {
    expect(parseWikiLink("主体性", "拉康视角@")).toEqual({
      term: "主体性",
      interpreter: null,
      display: "拉康视角@",
    });
  });

  it("@ 之前为空时显示完整别名（所见即所得）", () => {
    expect(parseWikiLink("主体性", "@拉康")).toEqual({
      term: "主体性",
      interpreter: "拉康",
      display: "@拉康",
    });
  });

  it("空白目标名返回 null；空白别名退回词条名显示", () => {
    expect(parseWikiLink("  ", null)).toBeNull();
    expect(parseWikiLink("主体性", "  ")).toEqual({
      term: "主体性",
      interpreter: null,
      display: "主体性",
    });
  });
});

describe("parseWikiLinks", () => {
  it("只提取真实 Markdown 节点，代码与转义示例不形成关系", () => {
    const source = [
      "[[异化|劳动异化]] [[主体性|通俗@拉康]] [[异化]] [[缺口]]",
      "", "```md", "[[围栏示例]]", "```", "",
      "    [[缩进示例]]", "", "`[[行内示例]]`", "",
      "\\[[转义示例]]", "", "> [[主体性|重读@拉康]]",
    ].join("\n");
    expect(parseWikiLinks(source)).toEqual([
      { term: "异化", interpreter: null, display: "劳动异化" },
      { term: "主体性", interpreter: "拉康", display: "通俗" },
      { term: "缺口", interpreter: null, display: "缺口" },
    ]);
  });
  it("提取默认与显式视角两类链接，按键去重保序", () => {
    const source = "[[异化]] 与 [[主体性|拉康视角@拉康]]，再说 [[异化]]";
    expect(parseWikiLinks(source)).toEqual([
      { term: "异化", interpreter: null, display: "异化" },
      { term: "主体性", interpreter: "拉康", display: "拉康视角" },
    ]);
  });

  it("同一词条的默认与显式形式是两条不同链接", () => {
    const source = "[[主体性]] 与 [[主体性|拉康视角@拉康]]";
    expect(parseWikiLinks(source)).toEqual([
      { term: "主体性", interpreter: null, display: "主体性" },
      { term: "主体性", interpreter: "拉康", display: "拉康视角" },
    ]);
  });

  it("同一显式目标的不同写法（键相同）只保留一条", () => {
    const source = "[[主体性|拉康视角@拉康]] 然后 [[主体性|重读@拉康]]";
    expect(parseWikiLinks(source)).toEqual([
      { term: "主体性", interpreter: "拉康", display: "拉康视角" },
    ]);
  });

  it("跨行文本与未闭合语法不误收", () => {
    expect(parseWikiLinks("[[异化\n]] 普通文本 [主体性] [[未闭合")).toEqual([]);
  });

  it("空名与纯空白名被忽略", () => {
    expect(parseWikiLinks("[[ ]] [[]] [[ |别名 ]]")).toEqual([]);
  });
});

describe("wikiLinkKey", () => {
  it("默认链接 = 词条名；显式视角链接 = 词条@诠释者（links.target_name 规范键）", () => {
    expect(wikiLinkKey({ term: "主体性", interpreter: null })).toBe("主体性");
    expect(wikiLinkKey({ term: "主体性", interpreter: "拉康" })).toBe("主体性@拉康");
  });
});

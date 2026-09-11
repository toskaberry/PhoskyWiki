// 扩容种子（T11 验收：种子 ≥100 词条，图元素达千级以验证图谱交互不卡死）。
//
// 与手写种子（seed.ts）的边界——既有集成/e2e 测试锁死了手写部分的精确计数
// （精神分析/法兰克福学派的核心词条数、既有分类的直接词条数），
// 因此扩容部分只使用：
//   - 全新词条（标题不带括号限定段、避开手写正文里的红链名：镜像阶段/规训/无意识）；
//   - 全新诠释者 + 全新学派（既有诠释者不写新视角，学派核心词条计数不动）；
//   - 分类只挂根：哲学/政治经济学 两个既有根 + 历史/精神分析 两个新根，
//     不在既有分类下加子分类、不给既有子分类挂新词条。
//
// 结构可复现：mulberry32 固定种子驱动诠释者分配与双链网络，配合 TRUNCATE restart
// identity，两次 seed 得到完全一致的 id 与边集。

import { inArray } from "drizzle-orm";

import type { Db } from "@/db";
import {
  categories,
  interpreters,
  links,
  pages,
  perspectives,
  revisions,
  schoolMembers,
  schools,
  termCategories,
  terms,
} from "@/db/schema";
import { slugify } from "@/lib/slug";
import { parseWikiLinks, wikiLinkKey } from "@/lib/wiki-links";

/** 领域：既是生成词条的分组，也是双链结构的聚类参数（哲学/政经/历史/精神分析）。 */
export type SeedDomain = "philosophy" | "economy" | "history" | "psychoanalysis";

interface ExtendedTerm {
  title: string;
  summary: string;
  domain: SeedDomain;
}

export const EXTENDED_TERMS: ExtendedTerm[] = [
  // ===== 哲学与方法 =====
  { title: "物化", summary: "商品结构把人的关系颠倒为物的关系，意识也随之凝固。", domain: "philosophy" },
  { title: "总体性", summary: "部分唯有置于整体的中介之中才可理解；马克思主义方法论的基石。", domain: "philosophy" },
  { title: "辩证法", summary: "概念在矛盾与运动中把握现实；从黑格尔到马克思的翻转。", domain: "philosophy" },
  { title: "历史唯物主义", summary: "物质生活的生产方式制约着社会、政治与精神生活的一般过程。", domain: "philosophy" },
  { title: "实践", summary: "人的感性对象性活动；问题在于改变世界，哲学只是解释。", domain: "philosophy" },
  { title: "扬弃", summary: "否定之中保留肯定成果的辩证过渡；外化与复归的结构。", domain: "philosophy" },
  { title: "主奴辩证法", summary: "生死斗争与劳动：奴隶在改造对象的过程中率先成为主体。", domain: "philosophy" },
  { title: "类本质", summary: "自由自觉的活动作为人的类特性；异化理论的规范基点。", domain: "philosophy" },
  { title: "表象", summary: "意识形态把历史的关系呈现为自然的关系的想象形式。", domain: "philosophy" },
  { title: "否定辩证法", summary: "对同一性思维的批判：概念必须承认自己的非概念性他者。", domain: "philosophy" },
  { title: "星丛", summary: "非同一要素的并置：主体与客体互为中介而非互相吞并。", domain: "philosophy" },
  { title: "认识论断裂", summary: "科学与意识形态之间的质变切口；理论史的非连续性。", domain: "philosophy" },
  { title: "多元决定", summary: "矛盾从不单独出场：由多个层次的社会实践共同决定。", domain: "philosophy" },
  { title: "偶然相遇的唯物主义", summary: "晚年阿尔都塞：历史是无主体的相遇过程，结构只是相遇的沉淀。", domain: "philosophy" },
  { title: "具体与抽象", summary: "从抽象上升到具体：思维用以再现整体的方法论道路。", domain: "philosophy" },
  { title: "时间性", summary: "历史时间的不均衡：诸社会层次各有自己的节律与相对自主性。", domain: "philosophy" },
  { title: "意识形态批判", summary: "揭穿观念的自然化：谁在言说？这套观念维持了谁的处境？", domain: "philosophy" },
  { title: "乌托邦", summary: "对未来的想象作为批判的尺度；尚未被意识到的可能性。", domain: "philosophy" },
  { title: "审美之维", summary: "艺术保有大拒绝的记忆，不被现实原则完全吸收。", domain: "philosophy" },
  { title: "间离效果", summary: "打断幻觉的戏剧技术：让批判的旁观者从观众中诞生。", domain: "philosophy" },
  { title: "光晕", summary: "传统艺术的本真性与距离感；机械复制使其凋谢。", domain: "philosophy" },
  { title: "文化工业", summary: "标准化的文化商品把主体生产为类型的消费者。", domain: "philosophy" },
  { title: "单向度", summary: "技术合理性吞掉否定性思维之后的社会精神形态。", domain: "philosophy" },
  { title: "虚假需求", summary: "由外部力量制造并维系的需求；发达工业社会的控制机制。", domain: "philosophy" },
  { title: "大拒绝", summary: "对既定现实整体的抗议口号；审美政治的出口。", domain: "philosophy" },
  { title: "批判理论", summary: "以解放为旨趣的跨学科社会研究纲领，与传统理论相对。", domain: "philosophy" },
  { title: "工具理性", summary: "目的—手段的效率逻辑对价值理性的殖民；启蒙的自我毁灭。", domain: "philosophy" },
  { title: "启蒙辩证法", summary: "支配自然的知识的自我批判：启蒙倒退为神话。", domain: "philosophy" },
  { title: "交往理性", summary: "语言交往中潜藏的理性前提；对意识哲学范式的出走。", domain: "philosophy" },
  { title: "公共领域", summary: "资产阶级公共领域的兴衰：从文学沙龙到大众传媒。", domain: "philosophy" },
  // ===== 政治经济学 =====
  { title: "资本积累", summary: "剩余价值的资本化：规模不断扩大的再生产过程。", domain: "economy" },
  { title: "资本有机构成", summary: "不变资本与可变资本之比；技术变革的度量衡。", domain: "economy" },
  { title: "利润率趋向下降", summary: "资本积累的内在矛盾：追逐利润的手段侵蚀利润的源泉。", domain: "economy" },
  { title: "生产过剩", summary: "生产的扩张撞上有效需求的狭窄基础；危机的经典形态。", domain: "economy" },
  { title: "产业后备军", summary: "失业与半失业人口调节工资：资本积累的伴生物。", domain: "economy" },
  { title: "原始积累", summary: "资本的前史：征服、奴役、掠夺与圈地。", domain: "economy" },
  { title: "商品拜物教", summary: "物与物的关系掩盖人与人的关系；价值的宗教。", domain: "economy" },
  { title: "使用价值", summary: "物的有用性；交换价值的物质承担者。", domain: "economy" },
  { title: "交换价值", summary: "不同使用价值相等的比例；价值的表现形式。", domain: "economy" },
  { title: "货币", summary: "价值的独立化形态：从流通手段到世界货币。", domain: "economy" },
  { title: "一般智力", summary: "社会知识成为直接生产力；固定资本的智慧形态。", domain: "economy" },
  { title: "自由竞争", summary: "资本的人格化彼此追逐剩余价值的制度形态。", domain: "economy" },
  { title: "垄断资本", summary: "集中与积聚的终点：大公司内部计划与市场无政府并存。", domain: "economy" },
  { title: "帝国主义", summary: "资本主义的垄断阶段：金融资本瓜分世界。", domain: "economy" },
  { title: "中心与外围", summary: "世界体系的不平等结构：交换不平等与发展的受阻。", domain: "economy" },
  { title: "不平等交换", summary: "价值经国际价格体系完成的隐蔽转移。", domain: "economy" },
  { title: "危机理论", summary: "崩溃、实现与比例失调：马克思主义内部的三大解释路线。", domain: "economy" },
  { title: "转形问题", summary: "价值到生产价格的转形；利润率与价值规律的一致性之争。", domain: "economy" },
  { title: "金融化", summary: "利润日益来自金融渠道而非生产与贸易的积累形态。", domain: "economy" },
  { title: "福特主义", summary: "大规模生产与大规模消费的结合；战后黄金时代的组织方式。", domain: "economy" },
  { title: "后福特主义", summary: "弹性积累、生产外包与消费分化的新组合。", domain: "economy" },
  { title: "非物质劳动", summary: "生产信息、情感与关系的劳动；最具争议的当代概念之一。", domain: "economy" },
  { title: "认知资本主义", summary: "知识与协作被卷入价值增殖的新积累体制。", domain: "economy" },
  { title: "公地", summary: "被圈占又不断被再生产出来的共有资源。", domain: "economy" },
  { title: "积累的社会结构", summary: "支撑一个积累阶段的制度组合；危机即其崩解。", domain: "economy" },
  { title: "调节模式", summary: "稳定积累所需的总制度形式：工资关系、货币与国家。", domain: "economy" },
  { title: "劳动力商品", summary: "劳动力作为特殊商品：它的使用价值就是创造价值的劳动。", domain: "economy" },
  { title: "工资形式", summary: "工资把无酬劳动表现为全部有酬劳动：剥削的表象层。", domain: "economy" },
  { title: "简单再生产", summary: "生产在原有规模上的重复；再生产分析的起点。", domain: "economy" },
  { title: "扩大再生产", summary: "剩余价值部分资本化；两大部类的交换图式。", domain: "economy" },
  { title: "长波", summary: "积累的扩张与停滞交替出现的半个世纪节律。", domain: "economy" },
  // ===== 历史 =====
  { title: "长时段", summary: "结构的时间压倒事件的时间：地理与经济的缓慢运动。", domain: "history" },
  { title: "年鉴学派", summary: "从事件史到总体史：结构与心态的社会史研究传统。", domain: "history" },
  { title: "自下而上的历史", summary: "从下层人民的经验重写历史；工人史研究的纲领。", domain: "history" },
  { title: "道德经济", summary: "群众骚乱背后的传统正义观念；对市场理性的抗议。", domain: "history" },
  { title: "阶级形成", summary: "阶级是历史关系而非结构位置；工人阶级在自己参与的形成中出场。", domain: "history" },
  { title: "文化转向", summary: "社会史向语言与表征的转移，及其结构主义批评者。", domain: "history" },
  { title: "社会史", summary: "以结构与日常生活为中心的历史写作；对政治史叙事的颠倒。", domain: "history" },
  { title: "微观史学", summary: "缩小尺度：一个村庄、一个磨坊主身上展开的整体。", domain: "history" },
  { title: "新文化史", summary: "表征、实践与身体：文化成为历史解释的中心范畴。", domain: "history" },
  { title: "民族主义", summary: "印刷资本主义与民族的诞生；想象的政治形式。", domain: "history" },
  { title: "想象的共同体", summary: "民族被想象为有限的、主权的共同体；想象的机制史。", domain: "history" },
  { title: "漫长的革命", summary: "文化、工业与民主三个层面的长时段互动。", domain: "history" },
  { title: "文化主义", summary: "把文化作为整体生活方式的解释路线；对经济还原论的反驳。", domain: "history" },
  { title: "感觉结构", summary: "一个时代的经验质量：尚在溶液中、未被沉淀为概念的社会经验。", domain: "history" },
  { title: "霸权", summary: "统治经由同意的制造而完成；强制只是背景保障。", domain: "history" },
  { title: "阵地战", summary: "对市民社会的阵地战取代运动战：西方革命战略的重估。", domain: "history" },
  { title: "有机知识分子", summary: "与阶级实践结合、组织一种文化的知识分子类型。", domain: "history" },
  { title: "历史集团", summary: "经济基础与上层建筑在具体历史形势中的统一体。", domain: "history" },
  { title: "被动革命", summary: "没有大众参与的改造：从上而下进行的革命形式。", domain: "history" },
  { title: "市民社会", summary: "国家与经济之间的组织层：工会、教会、学校与传媒。", domain: "history" },
  { title: "法国大革命", summary: "资产阶级革命的范型及其两百年未决的史学争论。", domain: "history" },
  { title: "俄国革命", summary: "1917 年两个政权并存的十个月与它的全球回声。", domain: "history" },
  { title: "巴黎公社", summary: "1871 年第一个工人政权的七十天。", domain: "history" },
  { title: "法西斯主义", summary: "极端民族主义与反革命大众动员的结合形态。", domain: "history" },
  { title: "福利国家", summary: "社会权利与阶级妥协的制度化，及其新自由主义拆解。", domain: "history" },
  { title: "新自由主义", summary: "市场作为组织社会的原则：项目、意识形态与国家形式。", domain: "history" },
  { title: "非殖民化", summary: "帝国的政治终结与其延续的经济结构。", domain: "history" },
  { title: "冷战", summary: "两大阵营的对抗及其对第三世界历史的塑形。", domain: "history" },
  // ===== 主体与精神分析 =====
  { title: "能指", summary: "语言中的差异单位；主体在能指链中被代表。", domain: "psychoanalysis" },
  { title: "大他者", summary: "象征秩序作为言说的第三方；主体的法律。", domain: "psychoanalysis" },
  { title: "欲望", summary: "欲望是他者的欲望：在欲望他人的欲望中结构自身。", domain: "psychoanalysis" },
  { title: "症候", summary: "被压抑者的返回；真相栖身于症状之中。", domain: "psychoanalysis" },
  { title: "享乐", summary: "快乐原则彼岸的满足；驱力悖论地追逐的货币。", domain: "psychoanalysis" },
  { title: "幻象", summary: "欲望的脚手架：抵御他者欲望之深渊的剧本。", domain: "psychoanalysis" },
  { title: "象征界", summary: "能指的秩序；主体进入语言付出的代价。", domain: "psychoanalysis" },
  { title: "想象界", summary: "镜像与相似性的秩序；自我的误认发生之处。", domain: "psychoanalysis" },
  { title: "实在界", summary: "无法象征化的硬核；创伤与剩余。", domain: "psychoanalysis" },
  { title: "驱力", summary: "绕着对象旋转的推力；与欲望的结构差异。", domain: "psychoanalysis" },
  { title: "转移", summary: "分析关系中的重复，与一种新型关系的建立。", domain: "psychoanalysis" },
  { title: "询唤", summary: "一声「嘿，你！」：意识形态把个体变成主体的时刻。", domain: "psychoanalysis" },
  { title: "主体化", summary: "个体被构成为主体的过程；权力与知识的交叉点。", domain: "psychoanalysis" },
  { title: "生命权力", summary: "对人口与生命的治理技术；现代权力的形态。", domain: "psychoanalysis" },
  { title: "治理术", summary: "引导行为的艺术；自由主义作为一种治理理性。", domain: "psychoanalysis" },
  { title: "全景敞视", summary: "可见性的装置：监视内化为自我规训。", domain: "psychoanalysis" },
];

interface ExtendedInterpreter {
  name: string;
  summary: string;
  birthYear?: number;
  deathYear?: number;
  domains: SeedDomain[];
}

export const EXTENDED_INTERPRETERS: ExtendedInterpreter[] = [
  { name: "卢卡奇", summary: "匈牙利马克思主义哲学家（1885–1971）：《历史与阶级意识》重建总体性与物化批判。", birthYear: 1885, deathYear: 1971, domains: ["philosophy"] },
  { name: "葛兰西", summary: "意大利马克思主义者（1891–1937）：霸权、阵地战与有机知识分子理论的创立者。", birthYear: 1891, deathYear: 1937, domains: ["history"] },
  { name: "本雅明", summary: "德国犹太思想家（1892–1940）：光晕、机械复制与历史天使。", birthYear: 1892, deathYear: 1940, domains: ["philosophy"] },
  { name: "列斐伏尔", summary: "法国马克思主义哲学家（1901–1991）：日常生活批判与空间的生产。", birthYear: 1901, deathYear: 1991, domains: ["philosophy", "history"] },
  { name: "霍布斯鲍姆", summary: "英国历史学家（1917–2012）：漫长的十九世纪与极端的年代。", birthYear: 1917, deathYear: 2012, domains: ["history"] },
  { name: "E.P.汤普森", summary: "英国历史学家（1924–1993）：《英国工人阶级的形成》，自下而上历史的范本。", birthYear: 1924, deathYear: 1993, domains: ["history"] },
  { name: "雷蒙·威廉斯", summary: "威尔士马克思主义批评家（1921–1988）：文化作为整体生活方式。", birthYear: 1921, deathYear: 1988, domains: ["history"] },
  { name: "佩里·安德森", summary: "英国历史学家与《新左派评论》主编（1938– ）：西方马克思主义的谱系学。", birthYear: 1938, domains: ["history", "philosophy"] },
  { name: "曼德尔", summary: "比利时经济学家（1923–1995）：晚期资本主义与长波理论。", birthYear: 1923, deathYear: 1995, domains: ["economy", "history"] },
  { name: "斯威齐", summary: "美国经济学家（1910–2004）：《资本主义发展论》与垄断资本。", birthYear: 1910, deathYear: 2004, domains: ["economy"] },
  { name: "大卫·哈维", summary: "英国地理学家（1935– ）：资本的城市化与空间修复。", birthYear: 1935, domains: ["economy", "history"] },
  { name: "科恩", summary: "加拿大政治哲学家（1941–2009）：《卡尔·马克思的历史理论》，分析马克思主义奠基。", birthYear: 1941, deathYear: 2009, domains: ["philosophy", "economy"] },
  { name: "罗默", summary: "美国经济学家（1945– ）：剥削的一般理论与其博弈论重构。", birthYear: 1945, domains: ["economy"] },
  { name: "埃尔斯特", summary: "挪威社会科学家（1940– ）：马克思主义的理性选择重述与批评。", birthYear: 1940, domains: ["philosophy"] },
  { name: "詹明信", summary: "美国批评家（1934– ）：后现代主义作为晚期资本主义的文化逻辑。", birthYear: 1934, domains: ["philosophy", "history"] },
  { name: "齐泽克", summary: "斯洛文尼亚哲学家（1949– ）：拉康式的意识形态批判。", birthYear: 1949, domains: ["psychoanalysis"] },
];

export const EXTENDED_SCHOOLS: { name: string; summary: string; members: string[] }[] = [
  {
    name: "西方马克思主义",
    summary: "1920 年代以后的西欧传统：在革命退潮中经卢卡奇、葛兰西、本雅明等人把马克思主义转向哲学、文化与美学领域。",
    members: ["卢卡奇", "葛兰西", "本雅明", "列斐伏尔"],
  },
  {
    name: "英国新左派",
    summary: "1956 年后的英国传统：霍布斯鲍姆、汤普森、威廉斯等人以社会史与文化研究重建马克思主义。",
    members: ["霍布斯鲍姆", "E.P.汤普森", "雷蒙·威廉斯", "佩里·安德森"],
  },
  {
    name: "激进政治经济学",
    summary: "战后北美传统：曼德尔、斯威齐、哈维等人发展垄断资本、长波与积累的空间理论。",
    members: ["曼德尔", "斯威齐", "大卫·哈维"],
  },
  {
    name: "分析的马克思主义",
    summary: "1970 年代末兴起的传统：科恩、罗默、埃尔斯特以分析工具重述马克思的核心论题。",
    members: ["科恩", "罗默", "埃尔斯特"],
  },
  {
    name: "当代文化批评",
    summary: "晚期资本主义文化的诊断者：詹明信的地理政治美学与齐泽克的意识形态崇高客体。",
    members: ["詹明信", "齐泽克"],
  },
];

/** 领域 → 挂载的分类根（前两个为既有根，后两个由扩容种子创建）。 */
const DOMAIN_CATEGORY_NAMES: Record<SeedDomain, { name: string; create: boolean }> = {
  philosophy: { name: "哲学", create: false },
  economy: { name: "政治经济学", create: false },
  history: { name: "历史", create: true },
  psychoanalysis: { name: "精神分析", create: true },
};

/** mulberry32：可复现的伪随机源（两次 seed 得到同一张图）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedSharedMaps {
  /** 词条/消歧义页标题 → page id（默认链接的解析表，扩容部分共用并回填） */
  titleToPageId: Map<string, number>;
  interpreterIds: Map<string, number>;
}

export interface SeedExtensionCounts {
  terms: number;
  interpreters: number;
  schools: number;
  categories: number;
  perspectives: number;
  links: { resolved: number; red: number };
}

/**
 * 灌入扩容内容（全新词条/诠释者/学派/根分类 + 生成视角与双链），
 * 回填 shared 解析表并落库生成视角的双链。批量插入以控制 seed 时长。
 */
export async function seedExtendedContent(
  db: Db,
  shared: SeedSharedMaps,
): Promise<SeedExtensionCounts> {
  const rng = mulberry32(20260907);
  const randInt = (n: number) => Math.floor(rng() * n);
  const pick = <T>(items: T[]): T => items[randInt(items.length)]!;

  // ---- 诠释者（pages 壳 + 负载表，批量）----
  const interpreterRows = await db
    .insert(pages)
    .values(
      EXTENDED_INTERPRETERS.map((interpreter) => ({
        type: "interpreter" as const,
        title: interpreter.name,
        slug: slugify(interpreter.name),
      })),
    )
    .returning({ id: pages.id, title: pages.title });
  const interpreterIdByName = new Map(interpreterRows.map((row) => [row.title, row.id]));
  await db.insert(interpreters).values(
    EXTENDED_INTERPRETERS.map((interpreter) => ({
      pageId: interpreterIdByName.get(interpreter.name)!,
      summary: interpreter.summary,
      birthYear: interpreter.birthYear ?? null,
      deathYear: interpreter.deathYear ?? null,
    })),
  );

  // ---- 学派（pages 壳 + 负载 + 成员）----
  const schoolRows = await db
    .insert(pages)
    .values(
      EXTENDED_SCHOOLS.map((school) => ({
        type: "school" as const,
        title: school.name,
        slug: slugify(school.name),
      })),
    )
    .returning({ id: pages.id, title: pages.title });
  const schoolIdByName = new Map(schoolRows.map((row) => [row.title, row.id]));
  await db.insert(schools).values(
    EXTENDED_SCHOOLS.map((school) => ({
      pageId: schoolIdByName.get(school.name)!,
      summary: school.summary,
    })),
  );
  await db.insert(schoolMembers).values(
    EXTENDED_SCHOOLS.flatMap((school) =>
      school.members.map((member) => ({
        schoolId: schoolIdByName.get(school.name)!,
        interpreterId: interpreterIdByName.get(member)!,
      })),
    ),
  );

  // ---- 新根分类（历史/精神分析；哲学与政治经济学沿用核心种子）----
  const toCreate = [...new Set(
    Object.values(DOMAIN_CATEGORY_NAMES).filter((c) => c.create).map((c) => c.name),
  )];
  const newCategoryRows = await db
    .insert(categories)
    .values(toCreate.map((name) => ({ name, slug: slugify(name) })))
    .returning({ id: categories.id, name: categories.name });
  const categoryIdByName = new Map(newCategoryRows.map((row) => [row.name, row.id]));
  const existingRoots = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(inArray(categories.name, ["哲学", "政治经济学"]));
  for (const row of existingRoots) categoryIdByName.set(row.name, row.id);

  // ---- 词条（pages 壳 + 负载 + 根分类挂载，批量）----
  const termRows = await db
    .insert(pages)
    .values(
      EXTENDED_TERMS.map((term) => ({
        type: "term" as const,
        title: term.title,
        slug: slugify(term.title),
      })),
    )
    .returning({ id: pages.id, title: pages.title });
  const termIdByTitle = new Map(termRows.map((row) => [row.title, row.id]));
  for (const [title, id] of termIdByTitle) shared.titleToPageId.set(title, id);
  for (const [name, id] of interpreterIdByName) shared.interpreterIds.set(name, id);

  await db.insert(terms).values(
    EXTENDED_TERMS.map((term) => ({
      pageId: termIdByTitle.get(term.title)!,
      summary: term.summary,
    })),
  );
  await db.insert(termCategories).values(
    EXTENDED_TERMS.map((term) => ({
      termId: termIdByTitle.get(term.title)!,
      categoryId: categoryIdByName.get(DOMAIN_CATEGORY_NAMES[term.domain].name)!,
    })),
  );

  // ---- 视角：每个词条 2~3 位新诠释者，正文携带 4~7 条双链 ----
  const termsByDomain = new Map<SeedDomain, string[]>();
  for (const term of EXTENDED_TERMS) {
    const list = termsByDomain.get(term.domain) ?? [];
    list.push(term.title);
    termsByDomain.set(term.domain, list);
  }
  const allTitles = [...shared.titleToPageId.keys()];

  interface PlannedPerspective {
    term: string;
    interpreter: string;
    content: string;
  }
  const planned: PlannedPerspective[] = [];
  let templateCursor = 0;

  for (const term of EXTENDED_TERMS) {
    const domainList = termsByDomain.get(term.domain)!;
    const index = domainList.indexOf(term.title);
    const domainInterpreters = EXTENDED_INTERPRETERS.filter((i) => i.domains.includes(term.domain));

    // 2~3 位领域内诠释者 + 概率性一位任意诠释者
    const chosen = new Map<string, ExtendedInterpreter>();
    const shuffled = [...domainInterpreters];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    for (const candidate of shuffled.slice(0, 2 + randInt(2))) {
      chosen.set(candidate.name, candidate);
    }
    if (rng() < 0.55 && chosen.size < 4) {
      const extra = pick(EXTENDED_INTERPRETERS);
      chosen.set(extra.name, extra);
    }

    for (const interpreter of chosen.values()) {
      // 双链：同域随机近邻 2 + 同域随机 2~3 + 跨域 3~4 + 概率性既有核心词条
      //（T11 验收要求图元素达千级：每个视角 7~9 条链接；近邻偏移按视角随机，
      //  避免同词条各视角共享固定近邻导致边集聚合后大量撞对）
      const candidates = new Set<string>();
      while (candidates.size < 2) {
        const offset = (1 + randInt(5)) * (rng() < 0.5 ? 1 : -1);
        const neighbor = domainList[(index + offset + domainList.length) % domainList.length]!;
        if (neighbor !== term.title) candidates.add(neighbor);
      }
      const sameRest = domainList.filter((t) => t !== term.title && !candidates.has(t));
      for (let i = 0; i < 2 + randInt(2); i++) {
        if (sameRest.length > 0) candidates.add(pick(sameRest));
      }
      const otherDomains = EXTENDED_TERMS.filter(
        (t) => t.domain !== term.domain && !candidates.has(t.title),
      ).map((t) => t.title);
      for (let i = 0; i < 3 + randInt(2); i++) {
        if (otherDomains.length > 0) candidates.add(pick(otherDomains));
      }
      if (rng() < 0.3) {
        const core = pick(allTitles);
        candidates.add(core);
      }
      candidates.delete(term.title);
      const linkTitles = [...candidates].slice(0, 7 + randInt(3));
      if (linkTitles.length < 4) continue;

      const [l0, l1, l2, l3, l4, l5] = linkTitles;
      const opening = [
        `在${interpreter.name}的框架里，「${term.title}」不是孤立的定义，而是一整个问题构型的入口。`,
        `「${term.title}」处在${interpreter.name}思想的中心地带：离开具体的历史处境，它的含义就无法展开。`,
        `对${interpreter.name}而言，「${term.title}」的关键在于它的中介性——把它从关系中抽出，剩下的只是意识形态的抽象。`,
        `${interpreter.name}对「${term.title}」的处理常被当作入门的捷径，但真正的分量在论证展开的方式里。`,
      ][templateCursor++ % 4]!;
      const parts = [
        opening,
        `它与[[${l0}]]、[[${l1}]]处在同一概念场，彼此的规定互为前提。`,
        `其历史前提可以追溯到[[${l2}]]${l3 ? `，当代形态则集中体现在[[${l3}]]的争论上` : ""}。`,
      ];
      if (l4) {
        parts.push(
          `沿这些线索追踪下去，才能避免把「${term.title}」读成教科书词组${l5 ? `；进一步的对照见[[${l4}]]与[[${l5}]]` : `；进一步的对照见[[${l4}]]`}。`,
        );
      }
      parts.push("（扩容种子视角：为图谱与三轴导航生成的示意内容，非完整诠释。）");
      planned.push({ term: term.title, interpreter: interpreter.name, content: parts.join("\n\n") });
    }
  }

  // 演示入口与扩容网络之间保留一条确定的桥。
  // 随机候选里的核心词条可能落在正文未使用的位置，不能依赖随机选链保证连通。
  planned[0]!.content += "\n\n阅读导航：可从[[价值]]对照规范性问题，再沿双链进入这里的哲学、政治经济学与历史网络。";

  // 视角页批量：pages 壳 + 负载 + 首修订
  const perspectiveRows = await db
    .insert(pages)
    .values(
      planned.map((p) => ({
        type: "perspective" as const,
        title: `${p.interpreter}论${p.term}`,
        slug: slugify(`${p.interpreter}论${p.term}`),
      })),
    )
    .returning({ id: pages.id, title: pages.title });
  const perspectiveIdByTitle = new Map(perspectiveRows.map((row) => [row.title, row.id]));
  await db.insert(perspectives).values(
    planned.map((p) => ({
      pageId: perspectiveIdByTitle.get(`${p.interpreter}论${p.term}`)!,
      termId: termIdByTitle.get(p.term)!,
      interpreterId: interpreterIdByName.get(p.interpreter)!,
    })),
  );
  await db.insert(revisions).values(
    planned.map((p) => ({
      pageId: perspectiveIdByTitle.get(`${p.interpreter}论${p.term}`)!,
      content: p.content,
    })),
  );

  // 双链落库（与核心种子同一规则：按标题解析，未命中留红链快照）
  let resolved = 0;
  let red = 0;
  const linkValues: {
    sourcePageId: number;
    targetPageId: number | null;
    targetName: string;
  }[] = [];
  for (const p of planned) {
    const sourcePageId = perspectiveIdByTitle.get(`${p.interpreter}论${p.term}`)!;
    for (const ref of parseWikiLinks(p.content)) {
      const targetId = shared.titleToPageId.get(ref.term) ?? null;
      if (targetId) resolved += 1;
      else red += 1;
      linkValues.push({ sourcePageId, targetPageId: targetId, targetName: wikiLinkKey(ref) });
    }
  }
  await db.insert(links).values(linkValues);

  return {
    terms: EXTENDED_TERMS.length,
    interpreters: EXTENDED_INTERPRETERS.length,
    schools: EXTENDED_SCHOOLS.length,
    categories: toCreate.length,
    perspectives: planned.length,
    links: { resolved, red },
  };
}

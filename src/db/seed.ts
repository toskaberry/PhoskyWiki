// 种子数据：读路径的第一批演示内容。
// T02 验收：≥3 词条、≥3 诠释者、≥4 视角（含具名诠释者视角、跨词条双链、红链）。
// T03 验收：≥2 学派（成员 + 派生核心词条就位）、分类树（多级 + 词条多挂）。
// T04 增补：显式视角链接（含红链示例）、同名分章示例（「价值」）。
// T11 增补：seedExtendedContent 扩容至 ≥100 词条/千级图元素（图谱性能验收）。
//
// seedDatabase() 幂等：TRUNCATE 全部内容表后按固定顺序重插（serial 因此确定），
// 集成测试与 e2e 共用这一份 fixture。生产环境不该跑它。

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { seedExtendedContent } from "@/db/seed-extended";
import {
  categories,
  discussionPosts,
  interpreters,
  links,
  pages,
  perspectives,
  revisions,
  schoolMembers,
  schools,
  submissionVotes,
  submissions,
  termCategories,
  termDiscussions,
  terms,
} from "@/db/schema";
import { slugify } from "@/lib/slug";
import { parseWikiLinks, wikiLinkKey } from "@/lib/wiki-links";

interface SeedTerm {
  title: string;
  aliases: string[];
  summary: string;
}

interface SeedInterpreter {
  name: string;
  summary: string;
  birthYear?: number;
  deathYear?: number;
}

interface SeedSchool {
  name: string;
  summary: string;
  /** 成员诠释者名。学派核心词条不在此挂载——由成员视角派生（强弱类型边界）。 */
  members: string[];
}

interface SeedCategory {
  name: string;
  parent: string | null;
}

interface SeedTermCategory {
  term: string;
  /** 一个词条可挂多个分类（弱类型标签树）。 */
  categories: string[];
}

interface SeedPerspective {
  term: string;
  interpreter: string;
  content: string;
}

const SEED_TERMS: SeedTerm[] = [
  {
    title: "主体性",
    aliases: ["主体", "subject"],
    summary:
      "「谁在思考、在行动」——这个看似最自明的问题，在各家体系里得到完全不同的回答。",
  },
  {
    title: "意识形态",
    aliases: ["观念形态", "ideology"],
    summary:
      "意义系统还是虚假意识？一个社会如何把个体制造为「自然」地服从的主体。",
  },
  {
    title: "异化",
    aliases: ["外化", "Entfremdung"],
    summary:
      "人造的世界反过来支配人：劳动产品、关系与本质如何成为敌对的力量。",
  },
  {
    title: "剩余价值",
    aliases: ["Mehrwert"],
    summary:
      "工人创造的价值超过其劳动力价格的部分——不等价的占有藏身于等价交换之中。",
  },
  {
    title: "价值",
    aliases: ["劳动价值", "value", "价值论", "axiology"],
    summary: "价值涉及社会生产关系，也涉及善、美与正当；不同含义在各诠释者的视角中分章展开。",
  },
];

const SEED_INTERPRETERS: SeedInterpreter[] = [
  {
    name: "拉康",
    summary:
      "法国精神分析学家（1901–1981），以「回到弗洛伊德」之名重写精神分析：无意识像语言一样被结构，主体在能指链中被构成。",
    birthYear: 1901,
    deathYear: 1981,
  },
  {
    name: "阿尔都塞",
    summary:
      "法国马克思主义哲学家（1918–1990），结构马克思主义的代表：意识形态询唤主体，历史是「无主体的过程」。",
    birthYear: 1918,
    deathYear: 1990,
  },
  {
    name: "马克思",
    summary:
      "德国哲学家与革命家（1818–1883），政治经济学批判的创立者：剩余价值、异化劳动与历史唯物主义。",
    birthYear: 1818,
    deathYear: 1883,
  },
  {
    name: "黑格尔",
    summary:
      "德国观念论哲学家（1770–1831），以《精神现象学》与《逻辑学》构建主体—实体的辩证体系。",
    birthYear: 1770,
    deathYear: 1831,
  },
  {
    name: "福柯",
    summary:
      "法国哲学家（1926–1984），知识考古学与系谱学：主体是权力/知识配置的历史效果。",
    birthYear: 1926,
    deathYear: 1984,
  },
  {
    name: "德勒兹",
    summary:
      "法国哲学家（1925–1995），与加塔利合著《反俄狄浦斯》：欲望机器、生成、差异的形而上学。",
    birthYear: 1925,
    deathYear: 1995,
  },
  {
    name: "弗洛伊德",
    summary:
      "奥地利神经学家、精神分析创始人（1856–1939）：无意识、压抑与梦的工作；「自我不是自己家里的主人」。",
    birthYear: 1856,
    deathYear: 1939,
  },
  {
    name: "阿多诺",
    summary:
      "德国哲学家与社会学家（1903–1969），法兰克福学派核心：《否定辩证法》与《启蒙辩证法》，同一性批判与文化工业论。",
    birthYear: 1903,
    deathYear: 1969,
  },
  {
    name: "马尔库塞",
    summary:
      "德裔美籍哲学家（1898–1979），法兰克福学派：《单向度的人》，发达工业社会的意识形态批判与爱欲解放论。",
    birthYear: 1898,
    deathYear: 1979,
  },
];

const SEED_SCHOOLS: SeedSchool[] = [
  {
    name: "精神分析",
    summary:
      "弗洛伊德创立的学科与思想传统：无意识、压抑、转移与梦的解释。经拉康的结构主义重写，成为二十世纪主体理论最重要的资源之一。",
    members: ["弗洛伊德", "拉康"],
  },
  {
    name: "法兰克福学派",
    summary:
      "围绕社会研究所形成的批判理论传统：霍克海默、阿多诺、马尔库塞等人把马克思主义与精神分析、美学批判结合，诊断「启蒙的辩证法」与文化工业。",
    members: ["阿多诺", "马尔库塞"],
  },
];

const SEED_CATEGORIES: SeedCategory[] = [
  { name: "哲学", parent: null },
  { name: "主体理论", parent: "哲学" },
  { name: "马克思主义", parent: null },
  { name: "意识形态批判", parent: "马克思主义" },
  { name: "异化理论", parent: "马克思主义" },
  { name: "政治经济学", parent: null },
];

const SEED_TERM_CATEGORIES: SeedTermCategory[] = [
  { term: "主体性", categories: ["主体理论", "马克思主义"] },
  { term: "意识形态", categories: ["意识形态批判"] },
  { term: "异化", categories: ["异化理论"] },
  { term: "剩余价值", categories: ["政治经济学", "马克思主义"] },
  { term: "价值", categories: ["政治经济学", "哲学"] },
];

const SEED_PERSPECTIVES: SeedPerspective[] = [
  {
    term: "剩余价值",
    interpreter: "马克思",
    content: `马克思在《资本论》第一卷第三篇分析剩余价值的生产：劳动力的使用能够创造超过劳动力自身价值的新价值。必要劳动时间与剩余劳动时间的区分，用于说明资本主义生产中的这一关系。

本演示视角关联[[价值]]与[[异化]]。来源：《资本论》第一卷，第三篇。`,
  },
  {
    term: "价值",
    interpreter: "马克思",
    content: `## 使用价值

马克思在《资本论》第一卷第一章从商品的有用性讨论使用价值。

## 价值

商品价值的分析涉及抽象人类劳动与社会必要劳动时间，进一步的问题见[[剩余价值]]。这与[[异化|马克思论异化@马克思]]的劳动问题形成阅读关联。

来源：《资本论》第一卷，第一章。本页是开发环境的简短演示视角。`,
  },
  {
    term: "主体性",
    interpreter: "拉康",
    content: `拉康的名言「无意识像语言一样被结构」意味着：主体不是先于语言的存在，而是在能指链中被构成的。婴儿在镜像阶段（约六到十八个月）把镜中的完整影像认作「自己」，从此以一个「他者的形象」来想象自身的统一——主体在起源处就是一个误认。

进入象征界后，主体进一步被大他者（语言与法的秩序）所询唤，「我」只是能指链上不断滑动的效果。因此拉康的主体是分裂的主体：言说的「我」永远无法与被言说的「我」重合。

在意识形态问题上，拉康的框架后来被阿尔都塞借用：意识形态把个体询唤为主体，正是一种镜像式的误认。可参照[[意识形态]]词条下阿尔都塞的视角；主体与对象颠倒的问题亦见[[异化]]。若想看[[镜像阶段]]作为独立概念的展开，该词条尚待撰写——这是一个写作缺口。同样尚待撰写的还有德里达对拉康的解构式读法[[主体性|德里达论主体性@德里达]]。`,
  },
  {
    term: "主体性",
    interpreter: "阿尔都塞",
    content: `阿尔都塞认为，「主体」从来不是给定的，而是意识形态机器的产品：当一个警察喊「嘿，你！」而你回头时，你已经被询唤为主体——接受了你在社会秩序中的位置。

主体性因此是一种双重的镜像结构：个体把自己认作自由的主体，恰恰是在服从的时刻。自由感是意识形态的最高效果。

这一论点直接改造了拉康的镜像阶段，也把[[意识形态]]从「虚假意识」重新定义为物质实践。与之对照，马克思在[[异化]]中对主体颠倒的描述仍停留在「本真自我可以被恢复」的期待上，阿尔都塞则认为主体之外无出口——只有作为过程的科学与政治实践。`,
  },
  {
    term: "主体性",
    interpreter: "黑格尔",
    content: `黑格尔的主体不是笛卡尔式的静止实体，而是自我运动的过程：主体只有在与它对立的对象世界中劳作、斗争、承受否定，才能返回自身并认出对象是「自己的他者」。

《精神现象学》中的主奴辩证法是这一运动的经典场景：两个自我意识生死相搏，胜者成为奴役中的「主人」却依赖奴隶的劳动确认自身；奴隶在劳动中改造对象，反而率先成长为真正的主体。

绝对精神的体系最终承诺：主体与实体、自我与世界在概念中达成和解。这个「和解」被后世不断攻击——马克思把它翻转到物质生产（见[[异化]]），拉康则宣布主体在语言中的分裂不可弥合。`,
  },
  {
    term: "主体性",
    interpreter: "马克思",
    content: `马克思对「主体是谁」的回答藏在《关于费尔巴哈的提纲》第六条：人的本质不是单个人所固有的抽象物，在其现实性上，它是一切社会关系的总和。主体性不是天赋，而是社会历史的产物。

更重要的是主体性的历史形态：在资本主义生产方式下，自由平等的「法律主体」恰恰是商品交换的人格化——市场面前人人平等，工厂之内服从分工。抽象的主体平等掩盖了具体的支配。

因此马克思不谈「一般主体」，而谈阶级主体：无产阶级之所以是历史的主体，不因为它贫困，而因为它的劳动就是社会本身，推翻[[异化]]的劳动条件即改造社会本身。经济机制的概念另见[[剩余价值]]。`,
  },
  {
    term: "主体性",
    interpreter: "福柯",
    content: `福柯拒绝「主体是什么」的提问方式，转问「主体如何被制造」：疯人、病人、囚犯、性变态——每个身份都是特定知识/权力配置在身体上刻下的效果。

规训技术（时间表、考核、全景敞视监狱）把身体塑造为「驯顺而有用的」力量；主体性不是被压抑的本真内核，而是权力关系的产物。权力不在主体之上，而在主体之中。

晚年福柯转向「自我技术」：主体如何通过对自我的劳作构成自身。这与拉康「主体在能指中被构成」的路径构成对照，也与[[意识形态]]的询唤理论互为参照。[[规训]]作为独立词条尚待撰写。`,
  },
  {
    term: "主体性",
    interpreter: "德勒兹",
    content: `德勒兹用「个体化」取代「主体」：真正的哲学形象不是「我思」，而是欲望生产着的身体与机器。主体不是出发点，而是欲望机器运作中的一个剩余效果——如同泡沫之于酿造。

与拉康的「欲望是缺乏」相反，德勒兹与加塔利主张欲望是生产：它连接、断开、流动，不围绕任何中心。主体因此应当被「稀释」为一条在强度中变动的线。

在这一视野下，把主体视为可异化又可复归的本真单位（如某些对[[异化]]的读法）恰恰是偶像崇拜；政治的任务不是恢复主体，而是释放生成。`,
  },
  {
    term: "意识形态",
    interpreter: "阿尔都塞",
    content: `阿尔都塞的《意识形态和意识形态国家机器》做出四个论断：意识形态没有历史；意识形态是个人与其生存条件的想象关系的「表象」；意识形态具有物质的存在（仪式、机构、实践）；意识形态把个体询唤为主体。

最后一论断把问题从「观念真伪」转移到「主体生产」：教堂、学校、家庭、媒体等意识形态国家机器日复一日地把个体制造为「自由主体」。详见[[主体性|阿尔都塞论主体性@阿尔都塞]]。

意识形态因此是「永恒的」——不存在无意识形态的社会，能改变的只是其形态。这与把意识形态视为可用科学彻底清除的幻象（某种启蒙立场）构成尖锐对立，也与[[异化]]的「复归本真」想象分道扬镳。`,
  },
  {
    term: "异化",
    interpreter: "马克思",
    content: `《1844 年经济学哲学手稿》给出劳动异化的四重规定：劳动者同劳动产品相异化（产品属于资本家）；同劳动活动相异化（劳动是被迫的、外在的）；同类本质相异化（自由自觉的活动本是人的类特性）；人与人相异化（一切关系被交换中介）。

在成熟期的《资本论》里，「异化」的术语退居幕后，分析让位于[[剩余价值]]的剥削机制——商品拜物教一节描述的「物与物的关系掩盖人与人的关系」，可视为异化理论在政治经济学批判中的完成形态。

争论在于：异化是否预设了一个本真的类本质？阿尔都塞后来主张根本不存在这样的「人本主义」主体——见[[意识形态|阿尔都塞论意识形态@阿尔都塞]]。黑格尔的原始版本则见本词条另一视角。`,
  },
  {
    term: "异化",
    interpreter: "黑格尔",
    content: `在《精神现象学》里，异化（Entfremdung）是精神的必经环节：意识把自己的本质外化为对象，又在对象中认出自己，从而上升为更高的意识形态。异化不是灾难，而是劳动与中介的结构本身。

主奴辩证法再次成为样板：奴隶在恐惧中劳动，把意志外化为物；正因为对象是他自己的作品，他得以在对象中直观自身——参见[[主体性]]词条的展开。

因此黑格尔的异化内含和解的承诺：外化必被扬弃。马克思后来质问：如果外化不是意识的自我运动，而是特定生产关系下的实际处境呢？见本词条之马克思视角。`,
  },
  {
    term: "主体性",
    interpreter: "弗洛伊德",
    content: `弗洛伊德对主体的第一个打击是地形学的：精神装置被划分为无意识、前意识与意识，「自我不是自己家里的主人」。你以为主宰着自己的念头，其实念头只是浮出水面的冰山一角，水面之下是愿望、压抑与防御的持续做工——梦、口误与症状就是那做工漏出的证据。

第二个打击是结构性的：本我、自我与超我不是三种「东西」，而是同一装置里的三个审级。自我骑在本我这匹马的背上，常常只是替本我的诉求找一个体面的说法；超我则以父母与社会之声的内化，对主体进行永不休庭的传讯。

因此弗洛伊德的主体天生是分裂的主体——这不是病理，而是精神的结构本身。文明以压抑为代价把欲望整理成「社会主体」，代价是神经症与持续的不满，这一思路与[[异化]]的问题域相邻。拉康后来把这一结构语言化；[[无意识]]作为独立词条尚待撰写。`,
  },
  {
    term: "主体性",
    interpreter: "阿多诺",
    content: `阿多诺拒绝「从主体出发」的哲学传统：康德与现象学都把主体当作不动的起点，而《否定辩证法》要做的恰恰是对这种起点的批判——主体在认识中始终带着前历史，没有无客体的主体，也没有无主体的客体。

关键命题是「客体的优先性」：不是主体综合客体，而是主体本身是客体的产物（社会、劳动、自然史）；但客体只有经由主体的反思才能被认识。主体与客体互为中介，谁也不是最终基础——阿多诺称之为「星丛」。把差异碾平为主体可支配的同一，这种同一性思维正是[[意识形态]]的认知根源。

这一思路的社会学对应是文化工业：标准化的文化商品把主体生产成类型的消费者，「个性」本身成了被出售的伪装。与[[异化]]叙事里「复归本真主体」的期待不同，阿多诺不承诺和解——在错误的生活中没有正确的生活，批判比许诺诚实。`,
  },
  {
    term: "意识形态",
    interpreter: "马尔库塞",
    content: `马尔库塞在《单向度的人》里给发达工业社会的意识形态下了功能主义的定义：它不再主要依靠强制或欺骗，而是靠「虚假的需求」与技术的合理性运转——住房、家电、汽车与娱乐把人们绑定在既定制度上，批判的尺度本身被生产的富裕消解。

结果是「单向度」：技术理性吞掉否定性思维，对立的需求被吸收为体制内的选项，「自由」萎缩为品牌之间的选择。工人阶级不再凭其在生产中的位置就是否定者——这是对经典马克思主义最刺痛的修正，[[剩余价值]]的抽象机制仍在运转，却不再自动产生政治的对立面。

出路因此诉诸体制外的边缘（被排斥者、异见的青年）与审美之维：艺术保有「大拒绝」的记忆，是意识形态闭环上的缺口。与阿尔都塞「意识形态无历史」的结构恒常论对照，马尔库塞仍保留了压迫性需求与真实需求的区分——也因此被批评为残留了[[主体性]]的人本主义地基。`,
  },
];

/** 清空内容表并重灌种子数据。返回计数摘要。 */
export async function seedDatabase(): Promise<{
  terms: number;
  disambiguations: number;
  interpreters: number;
  schools: number;
  perspectives: number;
  categories: number;
  links: { resolved: number; red: number };
}> {
  if (process.env.NODE_ENV === "production" || process.env.PHOSKYWIKI_ENV === "production") {
    throw new Error("Demo seed is forbidden in production; use ops:production bootstrap");
  }
  const db = getDb();
  await db.execute(
    sql`truncate table ${termDiscussions}, ${discussionPosts}, ${submissionVotes}, ${submissions}, ${links}, ${revisions}, ${perspectives}, ${termCategories}, ${categories}, ${schoolMembers}, ${schools}, ${interpreters}, ${terms}, ${pages} restart identity cascade`,
  );

  // 词条：pages 壳 + 负载
  const titleToPageId = new Map<string, number>();
  for (const term of SEED_TERMS) {
    const [page] = await db
      .insert(pages)
      .values({ type: "term", title: term.title, slug: slugify(term.title) })
      .returning({ id: pages.id });
    await db
      .insert(terms)
      .values({ pageId: page.id, summary: term.summary, aliases: term.aliases });
    titleToPageId.set(term.title, page.id);
  }

  const interpreterIds = new Map<string, number>();
  for (const interpreter of SEED_INTERPRETERS) {
    const [page] = await db
      .insert(pages)
      .values({
        type: "interpreter",
        title: interpreter.name,
        slug: slugify(interpreter.name),
      })
      .returning({ id: pages.id });
    await db.insert(interpreters).values({
      pageId: page.id,
      summary: interpreter.summary,
      birthYear: interpreter.birthYear ?? null,
      deathYear: interpreter.deathYear ?? null,
    });
    interpreterIds.set(interpreter.name, page.id);
  }

  // 学派：pages 壳 + 负载表 + 成员挂载（只挂诠释者；核心词条由成员视角派生）
  const schoolIds = new Map<string, number>();
  for (const school of SEED_SCHOOLS) {
    const [page] = await db
      .insert(pages)
      .values({ type: "school", title: school.name, slug: slugify(school.name) })
      .returning({ id: pages.id });
    await db.insert(schools).values({ pageId: page.id, summary: school.summary });
    schoolIds.set(school.name, page.id);
    for (const member of school.members) {
      await db.insert(schoolMembers).values({
        schoolId: page.id,
        interpreterId: interpreterIds.get(member)!,
      });
    }
  }

  // 分类树：弱类型标签（非页面），词条多挂
  const categoryIds = new Map<string, number>();
  for (const category of SEED_CATEGORIES) {
    const [row] = await db
      .insert(categories)
      .values({
        name: category.name,
        slug: slugify(category.name),
        parentId: category.parent ? categoryIds.get(category.parent)! : null,
      })
      .returning({ id: categories.id });
    categoryIds.set(category.name, row.id);
  }
  for (const { term, categories: termCats } of SEED_TERM_CATEGORIES) {
    const termId = titleToPageId.get(term)!;
    for (const name of termCats) {
      await db.insert(termCategories).values({ termId, categoryId: categoryIds.get(name)! });
    }
  }

  // 视角：pages 壳 + 负载表 + 首个修订（受理产生修订的种子等价物）
  const perspectiveIdByRef = new Map<string, number>();
  const perspectivePageIds: number[] = [];
  for (const perspective of SEED_PERSPECTIVES) {
    const termId = titleToPageId.get(perspective.term)!;
    const interpreterId = interpreterIds.get(perspective.interpreter)!;
    const title = `${perspective.interpreter}论${perspective.term}`;
    const [page] = await db
      .insert(pages)
      .values({ type: "perspective", title, slug: slugify(title) })
      .returning({ id: pages.id });
    await db
      .insert(perspectives)
      .values({ pageId: page.id, termId, interpreterId });
    await db.insert(revisions).values({ pageId: page.id, content: perspective.content });
    perspectiveIdByRef.set(wikiLinkKey({ term: perspective.term, interpreter: perspective.interpreter }), page.id);
    perspectivePageIds.push(page.id);
  }

  // 保存时解析（ADR-0003 #4）：默认链接按词条名解析；
  // 显式视角链接按「词条@诠释者」定位视角页；未命中留名称快照（红链）。
  // 页面先建全、链接后解析，链接目标与视角插入顺序无关。
  let resolvedLinks = 0;
  let redLinks = 0;
  for (const [index, perspective] of SEED_PERSPECTIVES.entries()) {
    for (const ref of parseWikiLinks(perspective.content)) {
      const targetId =
        ref.interpreter === null
          ? (titleToPageId.get(ref.term) ?? null)
          : (perspectiveIdByRef.get(wikiLinkKey(ref)) ?? null);
      if (targetId) resolvedLinks += 1;
      else redLinks += 1;
      await db.insert(links).values({
        sourcePageId: perspectivePageIds[index],
        targetPageId: targetId,
        targetName: wikiLinkKey(ref),
      });
    }
  }

  // T11 扩容：新词条/诠释者/学派 + 生成视角与双链（复用并回填上述解析表）
  const extended = await seedExtendedContent(db, { titleToPageId, interpreterIds });

  return {
    terms: SEED_TERMS.length + extended.terms,
    disambiguations: 0,
    interpreters: SEED_INTERPRETERS.length + extended.interpreters,
    schools: SEED_SCHOOLS.length + extended.schools,
    perspectives: SEED_PERSPECTIVES.length + extended.perspectives,
    categories: SEED_CATEGORIES.length + extended.categories,
    links: {
      resolved: resolvedLinks + extended.links.resolved,
      red: redLinks + extended.links.red,
    },
  };
}

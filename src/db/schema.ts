// Drizzle schema：PhoskyWiki 的全部表定义都收敛在这里。
// 数据模型见 ADR-0003「统一页面壳与 id 寻址」：
//   - pages 是所有可寻址页面的统一壳，修订/软删除/双链一律挂 page_id；
//   - 每类页面的专有字段放独立负载表（class-table inheritance），FK 到 pages.id；
//   - URL = /<type>/<slug>-<id>，id 永不改变，改名只换 slug。
// 消歧义的负载表随各自工单落地（不单独建模，见 ADR-0003 #6）。
//
// 强弱类型边界（CONTEXT.md）：学派是强类型实体只组织诠释者，分类是弱类型标签树只组织
// 词条。边界落在 schema 层——school_members.interpreter_id 只能指向 interpreters 负载表，
// term_categories.term_id 只能指向 terms 负载表；反向挂载违反外键被数据库拒绝。
// 学派「核心词条」不设挂载表：由成员视角聚合派生（content.ts），挂词条在 schema 上即不可能。

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import type { MetadataSnapshot, RevisionSource } from "@/lib/revision-snapshot";
import type { KeyText } from "@/lib/key-texts";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const pageTypeEnum = pgEnum("page_type", [
  "term",
  "perspective",
  "interpreter",
  "school",
  "disambiguation",
] as const);

export type PageType = (typeof pageTypeEnum.enumValues)[number];

/** 页面统一壳：一切可寻址内容（词条/视角/诠释者/学派/消歧义）都在这里有一行。 */
export const pages = pgTable(
  "pages",
  {
    id: serial("id").primaryKey(),
    type: pageTypeEnum("type").notNull(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    // 软删除标记；null = 在线。内容与历史全保留，恢复 = 清除标记（ADR-0003 #7）
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // 编者 user.id（better-auth 文本 id，T05）
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // 双链按名称解析，要求词条标题全局唯一（ADR-0003 #5）；同名多义用括号限定标题
    uniqueIndex("pages_term_title_unique")
      .on(t.title)
      .where(sql`type = 'term'`),
    index("pages_type_idx").on(t.type),
  ],
);

/** 词条负载表：概念名的聚合枢纽页，知识内容存于其下的视角。 */
export const terms = pgTable("terms", {
  keyTexts: jsonb("key_texts").$type<KeyText[]>().notNull().default([]),
  pageId: integer("page_id")
    .primaryKey()
    .references(() => pages.id, { onDelete: "cascade" }),
  // 一句话简介，词条页信息框与列表用；正文知识在视角里
  summary: text("summary").notNull().default(""),
  // 别名一期仅信息框展示，不参与双链解析（ADR-0003 #5）
  aliases: text("aliases")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
});

/** 诠释者负载表：给出诠释的思想家（如拉康），不是页面的撰写者。 */
export const interpreters = pgTable("interpreters", {
  keyTexts: jsonb("key_texts").$type<KeyText[]>().notNull().default([]),
  pageId: integer("page_id")
    .primaryKey()
    .references(() => pages.id, { onDelete: "cascade" }),
  summary: text("summary").notNull().default(""),
  birthYear: integer("birth_year"),
  deathYear: integer("death_year"),
});

/** 视角负载表：「诠释者 × 词条」的一次完整诠释，站内的原子知识单位。 */
export const perspectives = pgTable(
  "perspectives",
  {
    pageId: integer("page_id")
      .primaryKey()
      .references(() => pages.id, { onDelete: "cascade" }),
    termId: integer("term_id")
      .notNull()
      .references(() => terms.pageId, { onDelete: "cascade" }),
    interpreterId: integer("interpreter_id")
      .notNull()
      .references(() => interpreters.pageId, { onDelete: "cascade" }),
  },
  // 同一诠释者对同一词条只有一个视角
  (t) => [uniqueIndex("perspectives_term_interpreter_unique").on(t.termId, t.interpreterId)],
);

/** 学派负载表：诠释者的分组导航实体（如法兰克福学派），强类型，只组织诠释者。 */
export const schools = pgTable("schools", {
  pageId: integer("page_id")
    .primaryKey()
    .references(() => pages.id, { onDelete: "cascade" }),
  summary: text("summary").notNull().default(""),
});

/**
 * 学派成员：强类型边界所在——interpreter_id 只指向 interpreters 负载表，
 * 把词条/视角/学派挂入学派在 schema 层即被外键拒绝。
 */
export const schoolMembers = pgTable(
  "school_members",
  {
    schoolId: integer("school_id")
      .notNull()
      .references(() => schools.pageId, { onDelete: "cascade" }),
    interpreterId: integer("interpreter_id")
      .notNull()
      .references(() => interpreters.pageId, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ name: "school_members_pk", columns: [t.schoolId, t.interpreterId] }),
    index("school_members_interpreter_idx").on(t.interpreterId),
  ],
);

/**
 * 分类：萌百式弱类型标签树，只组织词条（知识主题），一期不是页面类型——
 * 无修订、无讨论、无软删除，分类树浏览是功能页而非实体页（ADR-0003 #2）。
 * name 即身份（寻址用 slug），parentId 自引用成树，根分类 parentId 为空。
 */
export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    parentId: integer("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    uniqueIndex("categories_name_unique").on(t.name),
    uniqueIndex("categories_slug_unique").on(t.slug),
    index("categories_parent_idx").on(t.parentId),
  ],
);

/**
 * 词条挂分类：弱类型边界的镜像——term_id 只指向 terms 负载表，
 * 把诠释者挂入分类在 schema 层即被外键拒绝。一个词条可挂多个分类。
 */
export const termCategories = pgTable(
  "term_categories",
  {
    termId: integer("term_id")
      .notNull()
      .references(() => terms.pageId, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ name: "term_categories_pk", columns: [t.termId, t.categoryId] }),
    index("term_categories_category_idx").on(t.categoryId),
  ],
);

/** 修订：每次受理/直编/回滚产生的全量内容快照（ADR-0004 #7/#9）。 */
export const revisions = pgTable(
  "revisions",
  {
    id: serial("id").primaryKey(),
    pageId: integer("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    // Markdown 源文本，全量存储；diff 是展示期产物，不落库（ADR-0004）
    content: text("content").notNull(),
    // Term metadata snapshots are independent of perspective Markdown; null marks legacy rows.
    snapshot: jsonb("snapshot").$type<MetadataSnapshot>(),
    source: text("source").$type<RevisionSource>().notNull().default("legacy"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    // 回滚创建新快照，来源指向同页既有修订（ADR-0004 #7）。
    rollbackFromId: integer("rollback_from_id").references((): AnyPgColumn => revisions.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("revisions_page_idx").on(t.pageId, t.id)],
);

/**
 * 双链：source → target，保存（受理产生修订）时解析落库（ADR-0003 #4）。
 * 目标页不存在则 target_page_id 为空、保留 target_name 文本快照——即红链；
 * 「写作缺口」视图 = target 为空的聚合，反链/图谱/热度排序共用本表。
 */
export const links = pgTable(
  "links",
  {
    id: serial("id").primaryKey(),
    sourcePageId: integer("source_page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    targetPageId: integer("target_page_id").references(() => pages.id, {
      onDelete: "cascade",
    }),
    targetName: text("target_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // 同一页面对同名目标只落一条
    uniqueIndex("links_source_name_unique").on(t.sourcePageId, t.targetName),
    index("links_target_idx").on(t.targetPageId),
  ],
);

// ---------------------------------------------------------------------------
// 审核域（T06）：提交与投票。语义见 ADR-0004——
// submissions 存全量提议内容 + base_revision_id（不存 diff，队列页 diff 现算）；
// pending → approved/rejected 均终态、任一驳回即 rejected、修改重提 = 新建提交；
// quorum = min(2, 提交创建时管理员数)，其后管理员人数变化不追溯；
// 管理员本人提交不经此表（直编直接生效，与受理共用修订管线）。
// ---------------------------------------------------------------------------

export const submissionStatusEnum = pgEnum("submission_status", [
  "pending",
  "approved",
  "rejected",
] as const);

export type SubmissionStatus = (typeof submissionStatusEnum.enumValues)[number];

/** 提议类型：编辑既有视角页，或新建词条/视角/诠释者页（新建同样进队列）。 */
export const submissionKindEnum = pgEnum("submission_kind", [
  "edit",
  "new_term",
  "new_perspective",
  "new_interpreter",
] as const);

export type SubmissionKind = (typeof submissionKindEnum.enumValues)[number];

export const submissions = pgTable(
  "submissions",
  {
    keyTexts: jsonb("key_texts").$type<KeyText[]>(),
    id: serial("id").primaryKey(),
    // 编辑目标页（kind=edit 必填）；新建类提议为空，建什么由 kind + 各字段决定
    pageId: integer("page_id").references(() => pages.id, { onDelete: "cascade" }),
    kind: submissionKindEnum("kind").notNull(),
    // 全量视角正文；new_term 与 new_interpreter 仅携带元数据，正文为空
    content: text("content").notNull().default(""),
    // 新建页的标题（new_perspective 由「诠释者论词条」派生，提交时留空）
    title: text("title"),
    // 新建词条/诠释者的一句话简介（terms/interpreters 负载字段）
    summary: text("summary"),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    // new_perspective 的挂载目标
    termId: integer("term_id").references(() => terms.pageId, { onDelete: "cascade" }),
    interpreterId: integer("interpreter_id").references(() => interpreters.pageId, {
      onDelete: "cascade",
    }),
    // 编辑起点的页面 head 修订（ADR-0004 #2 并发防护）；
    // 受理时页面 head ≠ base → 该票无法通过，自动驳回并提示基于新版重新提交
    baseRevisionId: integer("base_revision_id").references(() => revisions.id),
    status: submissionStatusEnum("status").notNull().default("pending"),
    // 受理所需批准票数：提交创建时快照的 min(2, 管理员数)（ADR-0004 #4）
    quorum: integer("quorum").notNull(),
    // 驳回理由：status=rejected 时必填（含 base 过期的系统驳回）
    rejectionReason: text("rejection_reason"),
    submittedBy: text("submitted_by").notNull().references(() => user.id),
    // 修改重提的谱系：指向被驳回的前任提交（ADR-0004 #5，便于个人主页分组）
    supersedesId: integer("supersedes_id").references((): AnyPgColumn => submissions.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    index("submissions_status_idx").on(t.status, t.id),
    index("submissions_submitter_idx").on(t.submittedBy),
  ],
);

// 一条提交只产生一次终态通知；收件人、结果和理由来自不可变的终态提交。
export const notifications = pgTable("notifications", {
  submissionId: integer("submission_id")
    .primaryKey()
    .references(() => submissions.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
});

export const submissionVoteEnum = pgEnum("submission_vote", ["approve", "reject"] as const);

export const submissionVotes = pgTable(
  "submission_votes",
  {
    id: serial("id").primaryKey(),
    submissionId: integer("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    adminId: text("admin_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    vote: submissionVoteEnum("vote").notNull(),
    // 驳回理由（vote=reject 时必有；approve 为空）
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // 一名管理员对一条提交至多一票：顺序批准、任一驳回即终态（ADR-0004 #3）
    uniqueIndex("submission_votes_admin_unique").on(t.submissionId, t.adminId),
    index("submission_votes_submission_idx").on(t.submissionId),
  ],
);

// ---------------------------------------------------------------------------
// 认证与角色（T05）：better-auth 邮箱密码 + 数据库会话。
// 表结构按 better-auth 的约定字段建模（src/lib/auth.ts 的 drizzleAdapter 指向这里），
// 应用自有字段只有 user.role（additionalFields 声明，input:false 客户端不可写）。
// ---------------------------------------------------------------------------

/**
 * 角色枚举（spec「Implementation Decisions」）：editor 编者 / admin 管理员。
 * trusted 为二期「免审编者晋级层」的预留扩展位——枚举先落库，业务语义随该工单再实现。
 * 「游客」不是数据库角色：未登录即游客，无 user 行。
 */
export const userRoleEnum = pgEnum("user_role", ["editor", "admin", "trusted", "superadmin"] as const);

export type UserRole = (typeof userRoleEnum.enumValues)[number];

/** 注册即 editor；角色调整由超级管理员执行。 */
export const user = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: userRoleEnum("role").notNull().default("editor"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** 角色变更的审计记录；账号移除后仍保留当时的身份 ID。 */
export const roleChanges = pgTable("role_changes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  actorId: text("actor_id").notNull(),
  targetUserId: text("target_user_id").notNull(),
  previousRole: userRoleEnum("previous_role").notNull(),
  newRole: userRoleEnum("new_role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 数据库会话（better-auth）：httpOnly cookie 存 token，服务端查本表。 */
export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("session_token_unique").on(t.token),
    index("session_user_idx").on(t.userId),
  ],
);

/**
 * 认证账号表：邮箱密码登录时 providerId = "credential"、password 存散列，
 * 结构同时兼容将来的 OAuth provider（一期不用）。
 */
export const account = pgTable(
  "account",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    // better-auth 1.7 的账号命名空间：本地凭据为 "local:credential"，OAuth 为其 issuer
    issuer: text("issuer").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("account_provider_account_unique").on(t.providerId, t.accountId),
    index("account_user_idx").on(t.userId),
  ],
);

/** 验证令牌（邮箱验证等，一期仅注册流程占位使用）。 */
export const verification = pgTable(
  "verification",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/** 限时单次准入/恢复能力。原始令牌只在签发响应中出现。 */
export const accessGrants = pgTable("access_grants", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  purpose: text("purpose").$type<"invitation" | "reset">().notNull(),
  digest: text("digest").notNull().unique(),
  targetUserId: text("target_user_id").references(() => user.id, { onDelete: "cascade" }),
  issuedBy: text("issued_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [
  check("access_grant_purpose_target", sql`(${t.purpose} = 'invitation' and ${t.targetUserId} is null) or (${t.purpose} = 'reset' and ${t.targetUserId} is not null)`),
  index("access_grants_target_idx").on(t.targetUserId),
]);

// ---------------------------------------------------------------------------
// 发现域（T12）：兴趣标签。三类自选关注维度——诠释者 / 学派 / 主题（主题轴
// 即分类，CONTEXT.md「兴趣标签」），驱动词条页视角重排与相关词条推荐。
// 游客的等价物只存浏览器 localStorage（lib/interest-tags.ts），登录后经
// PUT /api/interests 全量替换同步进账号——未登录不落库，不存在游客行。
// ---------------------------------------------------------------------------

/**
 * 一行 = 用户的一个兴趣。三个目标列恰好一个非空（CHECK 保证），非空列即兴趣类型
 * ——沿用 school_members / term_categories 的边界哲学：每列各自只指向本类型的表，
 * 跨类型挂载被外键拒绝；主题轴挂 categories.id（分类不是页面，无软删除）。
 */
export const interestTags = pgTable(
  "interest_tags",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    interpreterId: integer("interpreter_id").references(() => interpreters.pageId, {
      onDelete: "cascade",
    }),
    schoolId: integer("school_id").references(() => schools.pageId, {
      onDelete: "cascade",
    }),
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    check(
      "interest_tags_exactly_one_target",
      sql`num_nonnulls(${t.interpreterId}, ${t.schoolId}, ${t.categoryId}) = 1`,
    ),
    // NULL 视为相等：同一用户对同一目标只有一行（PG 15+ 的 NULLS NOT DISTINCT）
    unique("interest_tags_unique")
      .on(t.userId, t.interpreterId, t.schoolId, t.categoryId)
      .nullsNotDistinct(),
    index("interest_tags_user_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// 讨论区（T13）：词条级楼层 + 一层嵌套回复 + 视角锚点 + 版务。
// spec「discussion threads/posts（词条级挂载，视角锚点可选）」：
//   - 讨论挂在词条上，不挂 pages 壳——楼层不是页面（无修订/提交/软删除页面语义），
//     ADR-0003 的「讨论挂载以页面为锚点」落在 term_id 外键上；
//   - 一层嵌套：parentId 只指向同词条的顶层楼层（父自身必须是楼层），「回复的回复」
//     由应用层拒绝——CHECK 表达不了「父的父必须为空」，见 lib/discussion.ts；
//   - 版务：楼层软删（deletedAt/deletedBy，内容与作者保留）、讨论区锁定
//     （termDiscussions，行不存在 = 开放）。
// ---------------------------------------------------------------------------

/** 讨论楼层：词条讨论区的发言单元（顶层楼层，或对楼层的回复）。 */
export const discussionPosts = pgTable(
  "discussion_posts",
  {
    id: serial("id").primaryKey(),
    // 强类型边界：term_id 只指向 terms 负载表，把讨论挂到视角/诠释者/学派被外键拒绝
    termId: integer("term_id")
      .notNull()
      .references(() => terms.pageId, { onDelete: "cascade" }),
    // 视角锚点（可选）：视角页「就这个视角发起讨论」开出的楼层带上，渲染时可点击
    // 跳回该视角。视角页被物理删除时置空（软删除则保留，锚点链接只对在线视角渲染）
    perspectiveId: integer("perspective_id").references(() => perspectives.pageId, {
      onDelete: "set null",
    }),
    // 一层嵌套回复的父楼层；null = 顶层楼层
    parentId: integer("parent_id").references((): AnyPgColumn => discussionPosts.id),
    // 纯文本发言（不做 Markdown：页面内容经两票审核后发布，楼层即时可见，
    // 渲染保持纯文本转义 + 换行保留，把富格式留给受审内容）
    content: text("content").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("discussion_posts_term_idx").on(t.termId, t.id),
    index("discussion_posts_parent_idx").on(t.parentId),
  ],
);

/** 词条讨论区的版务状态：一行 = 一个词条的讨论区（锁定时懒创建，缺席即开放；发言不建行）。 */
export const termDiscussions = pgTable("term_discussions", {
  termId: integer("term_id")
    .primaryKey()
    .references(() => terms.pageId, { onDelete: "cascade" }),
  // 版务锁定：锁定后任何角色（含管理员）都不能再发言，解锁即恢复
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: text("locked_by").references(() => user.id),
});

/** T15：上传先落暂存对象；完成后冻结至独立 key，受理只发布冻结对象。 */
export const images = pgTable("images", {
  id: text("id").primaryKey(),
  uploadedBy: text("uploaded_by").notNull().references(() => user.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  stagingKey: text("staging_key").notNull().unique(),
  objectKey: text("object_key").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  expiredAt: timestamp("expired_at", { withTimezone: true }),
  stagingCleanedAt: timestamp("staging_cleaned_at", { withTimezone: true }),
}, (t) => [index("images_uploader_idx").on(t.uploadedBy)]);

/** Persistent per-account admission counters; one bounded row per operation. */
export const writeLimits = pgTable("write_limits", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull(),
  admitted: bigint("admitted", { mode: "number" }).notNull(),
  denied: bigint("denied", { mode: "number" }).notNull(),
}, t => [primaryKey({ columns: [t.userId, t.kind] })]);

/** Operational receipt only; PostgreSQL content remains the search source of truth. */
export const searchMaintenance = pgTable("search_maintenance", {
  indexUid: text("index_uid").primaryKey(),
  degraded: boolean("degraded").notNull().default(false),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  lastReindexAt: timestamp("last_reindex_at", { withTimezone: true }),
  lastReindexResult: text("last_reindex_result").notNull().default("never"),
});

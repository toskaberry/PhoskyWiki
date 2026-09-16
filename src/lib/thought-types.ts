// 划线感想的客户端投影（spec 0009 #73/#74）：服务端已按可见性过滤，
// 私密感想只出现在作者本人拿到的状态里，客户端不做任何权限判断。

export interface ThoughtReplyView {
  id: number;
  content: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  deleted: boolean;
  canDelete: boolean;
}

export interface ThoughtView {
  id: number;
  pageId: number;
  content: string;
  /** 发表时的原文引用（ADR-0008：正文修订后仍保留，面板据此展示语境）。 */
  quote: string;
  baseRevisionId: number;
  visibility: "public" | "private";
  authorId: string;
  authorName: string;
  authorImage: string | null;
  createdAt: string;
  deleted: boolean;
  agreeCount: number;
  agreed: boolean;
  /** located 时 start/end 是现行修订上的规范化偏移；original-changed 时引用仍保留。 */
  status: "located" | "original-changed";
  start: number | null;
  end: number | null;
  canDelete: boolean;
  replyable: boolean;
  canChangeVisibility: boolean;
  replies: ThoughtReplyView[];
}

export interface PageThoughtsState {
  thoughts: ThoughtView[];
  /** 读取时的 head 修订：客户端据此判断自己带来的选区锚是否已过期。 */
  revisionId: number;
}

/** located 视图的收窄类型：start/end 非空，可直接参与句子相交聚合与虚线渲染。 */
export type LocatedThoughtView = ThoughtView & { start: number; end: number };

export function isLocatedThought(thought: ThoughtView): thought is LocatedThoughtView {
  return thought.status === "located" && thought.start !== null && thought.end !== null;
}

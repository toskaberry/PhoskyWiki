"use client";

// 视角正文的行为层（spec 0009 #72/#73/#74）：微信读书式选区浮条 + 划线 + 划线感想。
//
// 正文 HTML 由服务端渲染（WikiContent），本组件在挂载后对正文 DOM 做三件事：
//   1. indexPassage 建立规范化文本索引（与 lib/passage-body.ts 的服务端投影一致，
//      并复用 splitSentences 得到句子边界）；
//   2. 渲染两层装饰（先虚线、再个人标记，虚线垫底）：
//      · 句子虚线 = 该句上有公开感想（统一灰虚线）或本人感想（红虚线，含私密）；
//      · 个人标记 = 高光/直线/波浪线（仅本人可见，随账号云端保存）。
//   3. 监听 selectionchange，在选区上方浮出工具条（复制 / 写想法 / 三种划线样式，
//      选中已有标记时附加「删除标记」）。
//
// 想法面板按「选区与句子相交」聚合该句上的感想，卡片含头像/昵称/正文/赞同/回复；
// 发布的感想与划线在同一次请求里原子落库（写感想自动划线）。错误提示与草稿保留：
// 网络失败不丢输入，基准修订过期时先确认再按读者看到的版本保存（ADR-0008）。
// 桌面优先：≥md 才出现浮条与写作入口，移动端只读（spec 0009 Q21）。

import Link from "next/link";
import { Check, Copy, Highlighter, MessageSquarePlus, Trash2, Underline, Waves } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { WikiContent } from "@/components/wiki-content";
import {
  isLocatedMark,
  markStyles,
  markStyleLabels,
  type MarkStyle,
  type PersonalMarkView,
  type PersonalMarksState,
} from "@/lib/mark-styles";
import {
  indexPassage,
  serializeSelection,
  type IndexedPassage,
  type PassageAnchor,
  type PassageSentence,
} from "@/lib/passage-anchors";
import { isLocatedThought, type PageThoughtsState, type ThoughtView } from "@/lib/thought-types";
import { thoughtsBySentence } from "@/lib/thought-sentences";

const styleIcons: Record<MarkStyle, typeof Highlighter> = {
  highlight: Highlighter,
  underline: Underline,
  squiggle: Waves,
};

interface ToolbarState {
  anchor: PassageAnchor;
  deletableIds: number[];
  /** 选区触及的句子（含整句范围），点「写想法」时聚合该句已有的感想。 */
  sentences: PassageSentence[];
}

function textNodesUnder(root: Element): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

/** 解开全部装饰并合并文本节点，保证正文 DOM 可反复重绘（canonical 文本始终不变）。 */
function unwrapAnnotations(root: Element) {
  // 装饰可以嵌套（虚线在外、标记在内），必须由内向外拆：先处理没有装饰后代的 span，
  // 拆掉最内层后它的父 span 才成为「最内层」而被下一轮处理。
  let remaining = Array.from(root.querySelectorAll<HTMLElement>("span.pw-mark, span.pw-thought-marker"));
  while (remaining.length) {
    const innermost = remaining.filter(span => !span.querySelector("span.pw-mark, span.pw-thought-marker"));
    for (const span of innermost) {
      const parent = span.parentNode;
      if (parent) {
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
      }
    }
    remaining = remaining.filter(span => !innermost.includes(span));
  }
  root.normalize();
}

interface Decoration {
  range: { start: number; end: number };
  /** 一句一条的个人层：虚线（垫底）或标记样式（压在上面）。 */
  decorate: (span: HTMLSpanElement) => void;
}

/**
 * 规范化正文偏移 → (文本节点, 节点内偏移)。
 *
 * 只能用 indexPassage 的边界图：正文里含投影合成的换行/空格（DOM 中不存在这些字符），
 * 直接按正文偏移切文本节点会错位。边界图的**数组下标就是节点内偏移**、其值才是正文偏移，
 * 所以按「offset = position + (目标 − boundaries[position])」换算，得到的就是节点坐标。
 * 空文本节点（块级之间合成的分隔宿主）不承载正文，不作为切分宿主。
 */
function resolvePoint(
  index: IndexedPassage,
  contentOffset: number,
): { node: Text; offset: number } | null {
  for (const [node, boundaries] of index.boundaries) {
    if (node.nodeType !== 3) continue;
    const text = node as unknown as Text;
    if (!text.data || boundaries.length !== text.data.length + 1) continue;
    for (let position = 0; position < boundaries.length; position++) {
      if (contentOffset < boundaries[position] || contentOffset >= boundaries[position] + 1) continue;
      const offset = position + (contentOffset - boundaries[position]);
      if (offset <= text.data.length) return { node: text, offset };
    }
  }
  return null;
}

/**
 * 单趟重绘全部装饰：把每个文本节点在「所有装饰的边界」处切段，按段包 span。
 *
 * 两个坐标系必须分清：装饰区间用的是 indexPassage 的**规范化正文偏移**，而切分要的是
 * 文本节点在文档序上的偏移。正文里含投影合成的换行/空格（节点里并不存在这些字符），
 * 所以两者不能直接换算 —— 统一走 indexPassage 的边界图得到 (节点, 节点内偏移)，
 * 只有边界图指向空节点时才退回按正文偏移扫描（空节点不承载正文，不能作为切分宿主）。
 * 逐条 wrapRange（切分 → 重定位 → 再切分）在反复渲染时会漂移，这里一次遍历统一切分。
 */
function renderDecorations(root: Element, index: IndexedPassage, decorations: Decoration[]) {
  const parts: { node: Text; start: number; length: number }[] = [];
  const nodes = textNodesUnder(root);
  let cursor = 0;
  for (const node of nodes) {
    parts.push({ node, start: cursor, length: node.data.length });
    cursor += node.data.length;
  }

  // 统一收集切分点：一次切分到位，之后不再动 DOM 结构
  const cuts = new Map<Text, Set<number>>();
  for (const decoration of decorations) {
    for (const position of [decoration.range.start, decoration.range.end]) {
      const resolved = resolvePoint(index, position);
      if (!resolved) continue;
      const set = cuts.get(resolved.node) ?? new Set<number>();
      set.add(resolved.offset);
      cuts.set(resolved.node, set);
    }
  }
  const segments: { start: number; end: number; node: Text }[] = [];
  for (const part of parts) {
    const offsets = [...(cuts.get(part.node) ?? [])].sort((a, b) => a - b);
    if (!offsets.length) {
      segments.push({ start: part.start, end: part.start + part.length, node: part.node });
      continue;
    }
    let node = part.node;
    // 偏移量是「相对原文本节点起点」的节点坐标；每切一次，目标节点就变成尾段，
    // 因此 consumed 必须跟着推进为上一次的偏移，否则后续偏移会被当成已越界而丢弃。
    let consumed = 0;
    for (const offset of offsets) {
      if (offset <= consumed || offset >= part.length) continue;
      const piece = node.splitText(offset - consumed);
      // 原节点留下 [consumed, offset)，新节点 piece 是剩余部分
      segments.push({ start: part.start + consumed, end: part.start + offset, node });
      node = piece;
      consumed = offset;
    }
    if (node.data.length) segments.push({ start: part.start + consumed, end: part.start + consumed + node.data.length, node });
  }

  for (const segment of segments) {
    if (!segment.node.data) continue;
    // 覆盖判定用区间相交（半开区间），与锚定算法同口径：正好落在边界上的句读
    // 不会被相邻装饰顺带包进去（否则「…重。」的句号会跟着标记一起被划线）。
    const covering = decorations.filter(decoration =>
      segment.start < decoration.range.end && segment.end > decoration.range.start);
    if (!covering.length) continue;
    // 传入顺序即渲染层次：先插入的在最内层（垫底），后插入的在最外层。
    // 因此倒序插入，让句子虚线成为最外层内层、个人标记压在上面。
    for (const decoration of [...covering].reverse()) {
      const span = document.createElement("span");
      decoration.decorate(span);
      segment.node.parentNode?.insertBefore(span, segment.node);
      span.appendChild(segment.node);
    }
  }
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

/** 感想卡片：头像/昵称/正文/赞同/回复（spec 0009 Q5）。 */
function ThoughtCard({
  thought, pending, onAgree, onToggleVisibility, onDelete, onReply, onStartReply, onDeleteReply, mobile,
}: {
  thought: ThoughtView;
  pending: boolean;
  onAgree: (thought: ThoughtView) => void;
  onToggleVisibility: (thought: ThoughtView) => void;
  onDelete: (thought: ThoughtView) => void;
  onReply: (thought: ThoughtView, content: string) => Promise<boolean>;
  onStartReply: (thought: ThoughtView) => boolean;
  onDeleteReply: (replyId: number) => void;
  mobile: boolean;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyPending, setReplyPending] = useState(false);

  async function submitReply() {
    if (replyPending || !replyText.trim()) return;
    setReplyPending(true);
    const ok = await onReply(thought, replyText.trim());
    setReplyPending(false);
    if (ok) { setReplyText(""); setReplyOpen(false); }
  }

  return <li id={`thought-${thought.id}`} tabIndex={-1} className="scroll-mt-20 rounded-lg border border-border p-3 focus:outline-2 focus:outline-primary">
    {thought.deleted ? <p className="text-sm italic text-muted-foreground">该想法已被删除。</p> : <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {thought.authorImage
          // 头像来自 better-auth 的账号字段（外链），不走 next/image 的优化管线
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={thought.authorImage} alt="" className="size-6 rounded-full" />
          : <span aria-hidden className="grid size-6 place-items-center rounded-full bg-muted text-xs text-muted-foreground">
              {thought.authorName.slice(0, 1)}
            </span>}
        <span className="font-medium">{thought.authorName}</span>
        <time dateTime={thought.createdAt} className="text-xs text-muted-foreground">{formatTime(thought.createdAt)}</time>
        {thought.visibility === "private" && <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">仅自己可见</span>}
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-relaxed">{thought.content}</p>
      <blockquote className="mt-2 border-l-2 border-border pl-3 text-xs text-muted-foreground">引用：{thought.quote}</blockquote>
      {thought.status === "original-changed" && <p className="mt-2 text-xs text-muted-foreground">
        <span className="font-medium">原文已变化</span>：想法按发表时的引用保存
      </p>}
    </>}
    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span>{thought.agreeCount} 赞同</span>
      {!mobile && !thought.deleted && thought.authorId !== "" && <>
        {thought.canChangeVisibility
          ? <button type="button" aria-label={`设为${thought.visibility === "public" ? "仅自己可见" : "公开"}`} disabled={pending}
              onClick={() => onToggleVisibility(thought)} className="hover:text-foreground">
              {thought.visibility === "public" ? "设为仅自己可见" : "设为公开"}
            </button>
          : <button type="button" aria-label={thought.agreed ? "取消赞同想法" : "赞同想法"} disabled={pending}
              onClick={() => onAgree(thought)} className="hover:text-foreground">
              {thought.agreed ? `取消赞同（${thought.agreeCount}）` : `赞同（${thought.agreeCount}）`}
            </button>}
        {thought.canDelete && <button type="button" aria-label="删除想法" disabled={pending}
          onClick={() => onDelete(thought)} className="hover:text-destructive">删除想法</button>}
        {thought.replyable && <button type="button" aria-label="回复想法" onClick={() => { if (onStartReply(thought)) setReplyOpen(open => !open); }}
          className="hover:text-foreground">回复想法</button>}
      </>}
      {mobile && <span>{thought.visibility === "private" ? "仅自己可见" : "公开"}</span>}
    </div>
    {thought.replies.length > 0 && <ul className="mt-3 flex flex-col gap-2 border-l-2 border-border pl-3">
      {thought.replies.map(reply => <li key={reply.id} className="text-sm">
        {reply.deleted ? <p className="italic text-muted-foreground">该回复已删除。</p> : <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{reply.authorName}</span>
            <time dateTime={reply.createdAt} className="text-xs text-muted-foreground">{formatTime(reply.createdAt)}</time>
            {!mobile && reply.canDelete && <button type="button" aria-label="删除回复" disabled={pending}
              onClick={() => onDeleteReply(reply.id)} className="text-xs text-muted-foreground hover:text-destructive">删除回复</button>}
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed">{reply.content}</p>
        </>}
      </li>)}
    </ul>}
    {!mobile && replyOpen && thought.replyable && <form className="mt-3" onSubmit={event => { event.preventDefault(); void submitReply(); }}>
      <label htmlFor={`thought-reply-${thought.id}`} className="sr-only">回复内容</label>
      <textarea id={`thought-reply-${thought.id}`} value={replyText} onChange={event => setReplyText(event.target.value)}
        rows={3} maxLength={2000} disabled={replyPending}
        className="block w-full rounded-md border border-border bg-background p-3 text-sm"
        placeholder="回复即时公开，仅支持纯文本，最多 2000 字符。" />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{replyText.length}/2000</span>
        <button type="submit" disabled={replyPending || !replyText.trim()}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
          {replyPending ? "发送中…" : "发送回复"}
        </button>
      </div>
    </form>}
  </li>;
}

export function PassageAnnotations({
  html,
  pageId,
  revisionId,
  initialMarks,
  initialDefaultStyle,
  initialThoughts,
  loggedIn,
  loginHref,
  viewerId,
}: {
  html: string;
  pageId: number;
  revisionId: number | null;
  initialMarks: PersonalMarkView[];
  initialDefaultStyle: MarkStyle;
  initialThoughts: ThoughtView[];
  loggedIn: boolean;
  loginHref: string;
  /** 当前登录用户 id：句子虚线按「是不是我的感想」切换红色分支。 */
  viewerId: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef<IndexedPassage | null>(null);
  const selectionRangeRef = useRef<Range | null>(null);
  const [marks, setMarks] = useState(initialMarks);
  const [thoughts, setThoughts] = useState(initialThoughts);
  const marksRef = useRef(marks);
  const thoughtsRef = useRef(thoughts);
  useEffect(() => { marksRef.current = marks; }, [marks]);
  useEffect(() => { thoughtsRef.current = thoughts; }, [thoughts]);
  const [defaultStyle, setDefaultStyle] = useState(initialDefaultStyle);
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 句子面板：opened 为该句已有的感想（含本人私密）；composer 为写想法表单
  const [panel, setPanel] = useState<{ sentence: PassageSentence; own: boolean } | null>(null);
  const [composer, setComposer] = useState<{ anchor: PassageAnchor; sentence: PassageSentence } | null>(null);
  const [draft, setDraft] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [staleConfirm, setStaleConfirm] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [changedOpen, setChangedOpen] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);

  const bodyRoot = useCallback(
    () => containerRef.current?.querySelector<HTMLElement>(":scope > .wiki-content") ?? null,
    [],
  );

  // 一期桌面优先：≥md 才出现浮条与写作入口，移动端只读（spec 0009 Q21）
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  /**
   * 句子虚线：与该句相交的感想 —— 公开的走灰虚线，本人的（公开或私密）走红虚线。
   * 聚合口径与句子面板一致（lib/thought-sentences），同意只画一条。
   */
  const sentenceMarkers = useCallback((sentences: PassageSentence[], list: ThoughtView[]) => {
    return thoughtsBySentence(sentences, list).map(group => ({
      sentence: group.sentence,
      // 本人的感想（公开或私密，私密只随本人登录返回）走红色虚线分支
      own: viewerId !== null && group.thoughts.some(thought => thought.authorId === viewerId),
      count: group.thoughts.length,
    }));
  }, [viewerId]);

  const renderAnnotations = useCallback((markList: PersonalMarkView[], thoughtList: ThoughtView[]) => {
    const root = bodyRoot();
    if (!root) return;
    unwrapAnnotations(root);
    const index = indexPassage(root);
    const decorations: Decoration[] = [];
    // 第一层：句子虚线（垫底）——公开感想灰虚线，本人感想红虚线
    for (const marker of sentenceMarkers(index.sentences, thoughtList)) {
      decorations.push({
        range: marker.sentence,
        decorate: (span) => {
          span.className = "pw-thought-marker";
          span.dataset.own = marker.own ? "true" : "false";
          span.dataset.sentenceStart = String(marker.sentence.start);
          span.title = marker.own ? "我的想法" : "这句话上的公开想法";
        },
      });
    }
    // 第二层：个人标记（覆盖在虚线上，两者都显示）
    for (const mark of markList.filter(isLocatedMark).sort((a, b) => a.start - b.start)) {
      decorations.push({
        range: { start: mark.start, end: mark.end },
        decorate: (span) => {
          span.className = `pw-mark pw-mark--${mark.style}`;
          span.dataset.markId = String(mark.id);
        },
      });
    }
    renderDecorations(root, index, decorations);
    indexRef.current = indexPassage(root);
  }, [bodyRoot, sentenceMarkers]);
  useEffect(() => { renderAnnotations(marks, thoughts); }, [renderAnnotations, marks, thoughts, html]);

  // 个人记录和登录回跳共用 thought-ID：先定位句子，再打开对应面板。
  useEffect(() => {
    const openFromHash = () => {
      const match = /^#thought-(\d+)$/.exec(window.location.hash);
      const thought = match ? thoughtsRef.current.find(row => row.id === Number(match[1])) : undefined;
      if (!thought) return;
      if (isLocatedThought(thought)) {
        const sentence = indexRef.current?.sentences.find(row => row.start < thought.end && row.end > thought.start);
        if (!sentence) return;
        bodyRoot()?.querySelector<HTMLElement>(`[data-sentence-start="${sentence.start}"]`)
          ?.scrollIntoView({ block: "center" });
        setChangedOpen(false);
        setPanel({ sentence, own: thought.authorId === viewerId });
      } else {
        setPanel(null);
        setChangedOpen(true);
      }
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [bodyRoot, viewerId]);

  useEffect(() => {
    if (!panel && !changedOpen) return;
    const match = /^#thought-(\d+)$/.exec(window.location.hash);
    if (!match) return;
    const frame = requestAnimationFrame(() => {
      const card = document.getElementById(`thought-${match[1]}`);
      card?.focus({ preventScroll: true });
      card?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [panel, changedOpen]);

  const toolbarRef = useRef<HTMLDivElement>(null);

  /** 浮条贴位于选区上方（放不下时翻到下方）；尺寸实测优先，通知文案变宽后也会重新贴位。 */
  const positionToolbar = useCallback(() => {
    const range = selectionRangeRef.current;
    if (!range) return;
    const rect = range.getBoundingClientRect();
    const element = toolbarRef.current;
    const width = element?.offsetWidth || 300;
    const height = element?.offsetHeight || 44;
    const x = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, 8), Math.max(window.innerWidth - width - 8, 8));
    const above = rect.top - height - 10;
    const next = above >= 8 ? { x, y: above, below: false } : { x, y: rect.bottom + 10, below: true };
    setPos(previous =>
      previous && previous.x === next.x && previous.y === next.y && previous.below === next.below ? previous : next);
  }, []);

  // 浮条内容变化（复制反馈/错误通知/删除入口）改变尺寸后重新贴位；等值守卫保证收敛
  useEffect(() => {
    if (toolbar) positionToolbar();
  });

  /** 评估当前选区：可序列化的正文选区拉起浮条，否则收起。 */
  const evaluateSelection = useCallback(() => {
    const root = bodyRoot();
    const index = indexRef.current;
    const selection = document.getSelection();
    const anchorNode = selection?.anchorNode ?? null;
    const focusNode = selection?.focusNode ?? null;
    const dismiss = () => {
      selectionRangeRef.current = null;
      setToolbar(null);
      setPos(null);
    };
    if (!root || !index || !selection || selection.rangeCount === 0 || selection.isCollapsed
      || !anchorNode || !focusNode || !root.contains(anchorNode) || !root.contains(focusNode)) {
      dismiss();
      return;
    }
    const anchor = serializeSelection(
      index,
      { node: anchorNode, offset: selection.anchorOffset },
      { node: focusNode, offset: selection.focusOffset },
      String(revisionId ?? ""),
    );
    if (!anchor) {
      dismiss();
      return;
    }
    selectionRangeRef.current = selection.getRangeAt(0).cloneRange();
    setToolbar({
      anchor,
      deletableIds: marksRef.current
        .filter(mark => isLocatedMark(mark) && mark.start < anchor.end && mark.end > anchor.start)
        .map(mark => mark.id),
      sentences: index.sentences.filter(sentence => sentence.start < anchor.end && sentence.end > anchor.start),
    });
    positionToolbar();
  }, [bodyRoot, positionToolbar, revisionId]);

  useEffect(() => {
    if (!isDesktop) return;
    let frame = 0;
    // 选区评估按帧合并（拖选期间不逐字符重算），但**在指针按下时立即补算一次**：
    // 刚选完就点浮条时，下一帧还没到，浮条尚未挂载，这一次点击会落空。
    const flush = () => {
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      evaluateSelection();
    };
    const onSelectionChange = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        evaluateSelection();
      });
    };
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("pointerdown", flush, true);
    window.addEventListener("scroll", positionToolbar, { passive: true });
    window.addEventListener("resize", positionToolbar);
    // 监听就位时先评估一次现行选区：水合/进入桌面宽度之前完成的选文也要能拉起浮条
    evaluateSelection();
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerdown", flush, true);
      window.removeEventListener("scroll", positionToolbar);
      window.removeEventListener("resize", positionToolbar);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [evaluateSelection, isDesktop, positionToolbar]);

  /** 虚线句子可点：打开该句感想面板（移动端只读，同样可看）。 */
  useEffect(() => {
    const root = bodyRoot();
    if (!root) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      let marker = target?.closest<HTMLElement>(".pw-thought-marker") ?? null;
      while (marker?.parentElement?.closest(".pw-thought-marker")) {
        marker = marker.parentElement.closest<HTMLElement>(".pw-thought-marker");
      }
      if (!marker) return;
      const start = Number(marker.dataset.sentenceStart);
      const index = indexRef.current;
      if (!index) return;
      const sentence = index.sentences.find(candidate => candidate.start === start);
      if (!sentence) return;
      setPanelError(null);
      setPanel({ sentence, own: marker.dataset.own === "true" });
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [bodyRoot, html]);

  const commitMarks = useCallback((state: PersonalMarksState) => {
    setMarks(state.marks);
    setDefaultStyle(state.defaultStyle);
    selectionRangeRef.current = null;
    setToolbar(null);
    setPos(null);
    document.getSelection()?.removeAllRanges();
  }, []);

  const commitThoughts = useCallback((state: PageThoughtsState) => {
    setThoughts(state.thoughts);
    setComposer(null);
    setDraft("");
    setStaleConfirm(false);
    setComposerError(null);
    selectionRangeRef.current = null;
    setToolbar(null);
    setPos(null);
    document.getSelection()?.removeAllRanges();
  }, []);

  const applyStyle = useCallback(async (style: MarkStyle) => {
    if (!toolbar || busy) return;
    setNotice(null);
    if (!loggedIn) {
      window.location.href = loginHref;
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/marks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pageId, anchor: toolbar.anchor, style }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setNotice(data?.error ?? "标记保存失败，请重试");
        return;
      }
      commitMarks(data as PersonalMarksState);
    } catch {
      setNotice("网络异常，标记未保存，请重试");
    } finally {
      setBusy(false);
    }
  }, [busy, commitMarks, loggedIn, loginHref, pageId, toolbar]);

  const removeMarks = useCallback(async () => {
    if (!toolbar?.deletableIds.length || busy) return;
    setNotice(null);
    setBusy(true);
    try {
      let state: PersonalMarksState | null = null;
      for (const id of toolbar.deletableIds) {
        const response = await fetch(`/api/marks/${id}?pageId=${pageId}`, { method: "DELETE" });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          setNotice((data as { error?: string } | null)?.error ?? "标记删除失败，请重试");
          return;
        }
        state = data as PersonalMarksState;
      }
      if (state) commitMarks(state);
    } catch {
      setNotice("网络异常，标记未删除，请重试");
    } finally {
      setBusy(false);
    }
  }, [busy, commitMarks, pageId, toolbar]);

  const copyQuote = useCallback(async () => {
    if (!toolbar) return;
    try {
      await navigator.clipboard.writeText(toolbar.anchor.quote);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setNotice("复制失败，请手动复制");
    }
  }, [toolbar]);

  /** 打开写想法表单：登录后方可，草稿与错误状态每次重开都重置。 */
  const openComposer = useCallback(() => {
    if (!toolbar) return;
    if (!loggedIn) {
      window.location.href = loginHref;
      return;
    }
    const sentence = toolbar.sentences[0] ?? { start: toolbar.anchor.start, end: toolbar.anchor.end, text: toolbar.anchor.quote };
    setComposer({ anchor: toolbar.anchor, sentence });
    setPanel(null);
    setDraft("");
    setStaleConfirm(false);
    setComposerError(null);
    setPanelError(null);
  }, [loggedIn, loginHref, toolbar]);

  /** 发布想法：一次请求原子落感想 + 自动划线；失败保留草稿，修订过期先确认。 */
  const publish = useCallback(async (confirmRevisionChange: boolean) => {
    if (!composer || busy) return;
    setBusy(true);
    setComposerError(null);
    try {
      const response = await fetch("/api/thoughts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pageId, anchor: composer.anchor, content: draft, visibility, style: defaultStyle, confirmRevisionChange,
        }),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 409) {
        setStaleConfirm(true);
        setComposerError(data?.error ?? "正文已更新，确认后按你看到的版本保存");
        return;
      }
      if (!response.ok) {
        setComposerError(data?.error ?? "发布失败，请重试");
        return;
      }
      commitThoughts(data as PageThoughtsState);
    } catch {
      setComposerError("网络异常，想法未发布，请重试");
    } finally {
      setBusy(false);
    }
  }, [busy, commitThoughts, composer, defaultStyle, draft, pageId, visibility]);

  /** 面板内互动后整表回读（赞同/回复/删除都返回新状态）。 */
  const refreshThoughts = useCallback(async () => {
    const response = await fetch(`/api/pages/${pageId}/thoughts`, { headers: { accept: "application/json" } });
    if (!response.ok) return false;
    setThoughts(((await response.json()) as PageThoughtsState).thoughts);
    return true;
  }, [pageId]);

  const loginForThought = useCallback((thought: ThoughtView) => {
    const url = new URL(loginHref, window.location.origin);
    url.searchParams.set("redirect", `${window.location.pathname}${window.location.search}#thought-${thought.id}`);
    window.location.href = url.href;
  }, [loginHref]);

  const startReply = useCallback((thought: ThoughtView) => {
    if (loggedIn) return true;
    loginForThought(thought);
    return false;
  }, [loggedIn, loginForThought]);

  const toggleAgree = useCallback(async (thought: ThoughtView) => {
    if (!loggedIn) { loginForThought(thought); return; }
    setBusy(true); setPanelError(null);
    try {
      const response = await fetch(`/api/thoughts/${thought.id}/agree`, { method: thought.agreed ? "DELETE" : "POST" });
      if (response.status === 401) { loginForThought(thought); return; }
      if (!response.ok) { setPanelError(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "操作失败，请重试"); return; }
      await refreshThoughts();
    } catch { setPanelError("网络异常，请重试"); }
    finally { setBusy(false); }
  }, [loggedIn, loginForThought, refreshThoughts]);

  const toggleVisibility = useCallback(async (thought: ThoughtView) => {
    setBusy(true); setPanelError(null);
    try {
      const response = await fetch(`/api/thoughts/${thought.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: thought.visibility === "public" ? "private" : "public" }),
      });
      if (!response.ok) { setPanelError(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "操作失败，请重试"); return; }
      await refreshThoughts();
    } catch { setPanelError("网络异常，请重试"); }
    finally { setBusy(false); }
  }, [refreshThoughts]);

  const removeThought = useCallback(async (thought: ThoughtView) => {
    setBusy(true); setPanelError(null);
    try {
      const response = await fetch(`/api/thoughts/${thought.id}`, { method: "DELETE" });
      if (!response.ok) { setPanelError(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "操作失败，请重试"); return; }
      await refreshThoughts();
    } catch { setPanelError("网络异常，请重试"); }
    finally { setBusy(false); }
  }, [refreshThoughts]);

  const replyThought = useCallback(async (thought: ThoughtView, content: string) => {
    if (!loggedIn) { loginForThought(thought); return false; }
    setBusy(true); setPanelError(null);
    try {
      const response = await fetch(`/api/thoughts/${thought.id}/replies`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }),
      });
      if (response.status === 401) { loginForThought(thought); return false; }
      if (!response.ok) { setPanelError(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "回复失败，请重试"); return false; }
      await refreshThoughts();
      return true;
    } catch { setPanelError("网络异常，请重试"); return false; }
    finally { setBusy(false); }
  }, [loggedIn, loginForThought, refreshThoughts]);

  const removeThoughtReply = useCallback(async (replyId: number) => {
    setBusy(true); setPanelError(null);
    try {
      const response = await fetch(`/api/thought-replies/${replyId}`, { method: "DELETE" });
      if (!response.ok) { setPanelError(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "操作失败，请重试"); return; }
      await refreshThoughts();
    } catch { setPanelError("网络异常，请重试"); }
    finally { setBusy(false); }
  }, [refreshThoughts]);

  const locatedThoughts = useMemo(
    () => thoughts.filter(isLocatedThought).sort((a, b) => a.start - b.start || a.id - b.id),
    [thoughts],
  );
  const changedThoughts = thoughts.filter(thought => thought.status === "original-changed");
  const panelThoughts = panel
    ? thoughtsBySentence([panel.sentence], locatedThoughts)[0]?.thoughts ?? []
    : [];
  const changedCount = marks.filter(mark => mark.status === "original-changed").length;

  return (
    <div ref={containerRef} className="relative">
      {(changedCount > 0 || changedThoughts.length > 0) && (
        <p className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted px-4 py-2 text-sm text-muted-foreground">
          {changedCount > 0 && <span>原文已修订：你有 {changedCount} 处划线无法在当前版本定位，建标时的引用仍随账号保留（ADR-0008）。</span>}
          {changedThoughts.length > 0 && <button type="button" onClick={() => setChangedOpen(true)}
            className="underline-offset-4 hover:text-foreground hover:underline">
            查看原文已变化的想法（{changedThoughts.length}）
          </button>}
        </p>
      )}
      <WikiContent html={html} />
      {isDesktop && toolbar && pos && (
        <div
          ref={toolbarRef}
          role="toolbar"
          tabIndex={0}
          aria-label="划线工具条"
          // 浮条上的 mousedown 不折叠正文选区：否则按下瞬间选区消失、浮条随之
          // 拆卸，click 落空（富文本工具条的标准做法）
          onMouseDown={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            // 浮条本体聚焦时 Enter/空格应用默认样式；按钮自身的键盘激活不走这里
            if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
              event.preventDefault();
              void applyStyle(defaultStyle);
            }
          }}
          className="pw-selection-toolbar fixed z-50 flex select-none items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
          style={{ left: pos.x, top: pos.y }}
        >
          <button
            type="button"
            onClick={() => void copyQuote()}
            aria-label="复制所选文字"
            className="flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
          >
            {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
            {copied ? "已复制" : "复制"}
          </button>
          <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          <button
            type="button"
            onClick={openComposer}
            aria-label="写想法"
            className="flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
          >
            <MessageSquarePlus aria-hidden className="size-4" />
            写想法
          </button>
          <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          {markStyles.map((style) => {
            const Icon = styleIcons[style];
            const isDefault = style === defaultStyle;
            return (
              <button
                key={style}
                type="button"
                disabled={busy}
                data-default={isDefault ? "true" : undefined}
                onClick={() => void applyStyle(style)}
                aria-label={`${markStyleLabels[style]}划线${isDefault ? "（默认样式）" : ""}`}
                title={isDefault ? `${markStyleLabels[style]}（默认样式）` : markStyleLabels[style]}
                className="pw-style-button flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 disabled:opacity-50"
              >
                <Icon aria-hidden className="size-4" />
                {markStyleLabels[style]}
              </button>
            );
          })}
          {toolbar.deletableIds.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void removeMarks()}
              aria-label="删除标记"
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-destructive hover:bg-accent disabled:opacity-50"
            >
              <Trash2 aria-hidden className="size-4" />
              删除标记
            </button>
          )}
          {notice && (
            <span role="alert" className="max-w-40 px-2 text-xs text-destructive">
              {notice}
            </span>
          )}
          <span
            aria-hidden
            className={`pw-selection-toolbar-caret ${pos.below ? "pw-selection-toolbar-caret--below" : ""}`}
          />
        </div>
      )}

      {composer && (
        <div role="dialog" aria-label="写想法" aria-modal="true"
          className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-2xl rounded-t-lg border border-border bg-popover p-4 shadow-xl md:inset-x-auto md:right-8 md:bottom-8 md:rounded-lg">
          <p className="text-xs text-muted-foreground">针对这句：{composer.sentence.text}</p>
          <form className="mt-2" onSubmit={event => { event.preventDefault(); void publish(staleConfirm); }}>
            <label htmlFor="thought-draft" className="sr-only">想法内容</label>
            <textarea id="thought-draft" value={draft} onChange={event => setDraft(event.target.value)}
              rows={3} maxLength={2000} disabled={busy}
              className="block w-full rounded-md border border-border bg-background p-3 text-sm"
              placeholder="写下你对这句话的想法，最多 2000 字符。" />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label htmlFor="thought-visibility" className="text-sm">可见性</label>
              <select id="thought-visibility" value={visibility} disabled={busy}
                onChange={event => setVisibility(event.target.value === "private" ? "private" : "public")}
                className="rounded-md border border-border bg-background px-2 py-1 text-sm">
                <option value="public">公开</option>
                <option value="private">仅自己可见</option>
              </select>
              <span className="text-xs text-muted-foreground">{draft.length}/2000 · 默认以{markStyleLabels[defaultStyle]}划线</span>
              <span className="ml-auto flex items-center gap-2">
                <button type="button" disabled={busy} onClick={() => { setComposer(null); setStaleConfirm(false); setComposerError(null); }}
                  className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">收起</button>
                <button type="submit" disabled={busy || !draft.trim()}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
                  {busy ? "发布中…" : staleConfirm ? "确认以原选文发布" : "发布想法"}
                </button>
              </span>
            </div>
            {composerError && <p role="alert" className="mt-2 text-sm text-destructive">{composerError}</p>}
            {staleConfirm && <p className="mt-1 text-xs text-muted-foreground">
              正文已更新，想法按你看到的版本保存：原引用与版本入口都会保留（ADR-0008）。
            </p>}
          </form>
        </div>
      )}

      {(panel || changedOpen) && (
        <div role="dialog" aria-label="句子想法" aria-modal="true"
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-popover shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-border p-4">
            <div>
              <h2 className="text-base font-semibold">{changedOpen ? "原文已变化的想法" : "这句话上的想法"}</h2>
              {panel && <p className="mt-1 text-xs text-muted-foreground">{panel.sentence.text}</p>}
              {changedOpen && <p className="mt-1 text-xs text-muted-foreground">这些想法发表时的原文已无法在当前版本定位，引用与版本入口照旧保留。</p>}
            </div>
            <button type="button" aria-label="关闭想法面板"
              onClick={() => { setPanel(null); setChangedOpen(false); setPanelError(null); }}
              className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground">关闭</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {panelError && <p role="alert" className="mb-3 text-sm text-destructive">{panelError}</p>}
            {(() => {
              const list = changedOpen ? changedThoughts : panelThoughts;
              return list.length === 0
                ? <p className="text-sm text-muted-foreground">这句话上还没有想法。</p>
                : <ul className="flex flex-col gap-3">
                    {list.map(thought => <ThoughtCard key={thought.id} thought={thought} pending={busy}
                      onAgree={toggleAgree} onToggleVisibility={toggleVisibility} onDelete={removeThought}
                      onReply={replyThought} onStartReply={startReply} onDeleteReply={removeThoughtReply} mobile={!isDesktop} />)}
                  </ul>;
            })()}
            {changedOpen && <ul className="mt-4 flex flex-col gap-2 border-t border-border pt-3 text-sm">
              {changedThoughts.map(thought => <li key={`revision-${thought.id}`}>
                <Link href={`/history/${pageId}?from=${thought.baseRevisionId}&to=${thought.baseRevisionId}`}
                  className="text-primary underline-offset-4 hover:underline">查看原修订</Link>
                <span className="ml-2 text-xs text-muted-foreground">「{thought.quote}」</span>
              </li>)}
            </ul>}
          </div>
        </div>
      )}
    </div>
  );
}

/** 兼容别名：视角页与既有测试用的组件名。 */
export const PassageMarks = PassageAnnotations;

"use client";

// 双链的 Wikipedia 式紧凑内容预览（#85）——共享 Markdown 展示边界的统一行为层。
//
// 正文 HTML 由服务端渲染（WikiContent），本组件不改动正文 DOM：在 document 上
// 委托监听，只对 .wiki-content 内的 a.wiki-link 生效（覆盖视角正文、编辑实时
// 预览与审核提案预览；红链/暂不可用是 span，不触发）。卡片经 portal 挂到
// body 末端，处在正文文本索引区域之外，不碰选区、复制与个人划线。
//
// 交互（约 650ms 悬停延迟参考 Wikimedia Page Previews）：
//   · 鼠标/触控笔悬停约 650ms 后打开；短暂划过不打开；触屏不开卡，点击直接导航。
//   · 键盘聚焦（:focus-visible）立即打开；Tab 从链接进入卡片入口，最后一个入口
//     Tab / Shift+Tab / Esc 关闭并把焦点还给链接——不困住焦点。
//   · 指针移入卡片保持打开；离开链接与卡片后关闭。
//   · 卡片内的链接不再递归弹出预览（卡片不在 .wiki-content 内）。
//   · 点击原始链接始终是原生导航：预览加载、失败、显示都不拦截。
//
// 请求带序号令牌：快速切换目标或离开后迟到的响应一律丢弃，不串内容、不复活卡片。

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { WikiLinkPreview } from "@/lib/wiki-link-preview";
import { decodePageKey, parsePageKey } from "@/lib/slug";

/** 悬停停留多久才打开卡片；短暂划过不触发。 */
const HOVER_DELAY_MS = 650;
/** 离开链接后多久关闭：给指针移入卡片的间隙。 */
const CLOSE_GRACE_MS = 180;
/** 紧凑卡片的目标宽度与最大高度（#85 已确认取值）；同时受视口可用空间约束。 */
const CARD_WIDTH = 320;
const CARD_MAX_HEIGHT = 280;
const VIEWPORT_MARGIN = 8;
const CARD_GAP = 8;
/** 首次定位时卡片尚未渲染，用估算高度参与上下翻面判断。 */
const ESTIMATED_HEIGHT = 160;

type PreviewPayload = WikiLinkPreview;

interface OpenCard {
  anchor: HTMLAnchorElement;
  pageId: number;
  status: "loading" | "ready" | "error";
  payload: PreviewPayload | null;
}

/** 预览只服务双链两种落点：/<type>/<slug>-<id>，id 是唯一权威（ADR-0003）。 */
function pageIdFromHref(href: string): number | null {
  try {
    const { pathname } = new URL(href, window.location.href);
    const match = /^\/(?:term|perspective)\/([^/]+)$/.exec(pathname);
    return match ? parsePageKey(decodePageKey(match[1])) : null;
  } catch {
    return null;
  }
}

function linkFromEvent(event: Event): HTMLAnchorElement | null {
  if (!(event.target instanceof Element)) return null;
  const anchor = event.target.closest<HTMLAnchorElement>("a.wiki-link");
  // 只在共享 Markdown 展示边界内生效；卡片浮层（在边界外）里的链接不递归预览
  return anchor && anchor.closest(".wiki-content") ? anchor : null;
}

async function fetchPreview(pageId: number): Promise<PreviewPayload> {
  const response = await fetch(`/api/pages/${pageId}/preview`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`preview ${response.status}`);
  const payload = (await response.json()) as PreviewPayload | null;
  if (!payload || (payload.kind !== "term" && payload.kind !== "perspective")) {
    throw new Error("preview payload");
  }
  return payload;
}

export function WikiLinkPreviews() {
  // 卡片只在事件处理器里打开（悬停/聚焦），届时必在客户端，portal 无需挂载标记
  const [card, setCard] = useState<OpenCard | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  const openRef = useRef(false);
  const openTimer = useRef(0);
  const closeTimer = useRef(0);
  const pendingAnchor = useRef<HTMLAnchorElement | null>(null);
  const requestSeq = useRef(0);

  const stopTimers = useCallback(() => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  }, []);

  const positionCard = useCallback((anchor: HTMLAnchorElement) => {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(CARD_WIDTH, window.innerWidth - 2 * VIEWPORT_MARGIN);
    const height = cardRef.current?.offsetHeight ?? ESTIMATED_HEIGHT;
    const left = Math.min(
      Math.max(rect.left, VIEWPORT_MARGIN),
      Math.max(window.innerWidth - width - VIEWPORT_MARGIN, VIEWPORT_MARGIN),
    );
    let top = rect.bottom + CARD_GAP;
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      const above = rect.top - CARD_GAP - height;
      top = above >= VIEWPORT_MARGIN
        ? above
        : Math.max(VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN - height);
    }
    setPos((previous) =>
      previous && previous.left === left && previous.top === top && previous.width === width
        ? previous
        : { left, top, width });
  }, []);

  const openCard = useCallback((anchor: HTMLAnchorElement) => {
    const pageId = pageIdFromHref(anchor.href);
    if (pageId === null) return;
    stopTimers();
    anchorRef.current = anchor;
    openRef.current = true;
    pendingAnchor.current = null;
    setCard((previous) =>
      previous && previous.anchor === anchor
        ? previous
        : { anchor, pageId, status: "loading", payload: null },
    );
    positionCard(anchor);
    const seq = ++requestSeq.current;
    fetchPreview(pageId)
      .then((payload) => {
        // 目标已切换或卡片已关闭：迟到响应直接丢弃，不串内容、不复活卡片
        if (seq !== requestSeq.current) return;
        setCard((previous) =>
          previous && previous.anchor === anchor && previous.pageId === pageId
            ? { ...previous, status: "ready", payload }
            : previous,
        );
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setCard((previous) =>
          previous && previous.anchor === anchor && previous.pageId === pageId
            ? { ...previous, status: "error", payload: null }
            : previous,
        );
      });
  }, [positionCard, stopTimers]);

  const closeCard = useCallback((restoreFocus: boolean) => {
    stopTimers();
    requestSeq.current++;
    pendingAnchor.current = null;
    openRef.current = false;
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (restoreFocus && anchor) {
      const active = document.activeElement;
      // Esc / 卡片两端收尾：焦点在卡片内或链接上时，把焦点还给触发链接，
      // 键盘操作不因卡片关闭而丢失位置；焦点已移往别处则不抢回。
      const inCard = active instanceof Node && cardRef.current?.contains(active) === true;
      if (inCard || active === anchor) anchor.focus({ preventScroll: true });
    }
    setCard(null);
    setPos(null);
  }, [stopTimers]);

  useEffect(() => {
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      const anchor = linkFromEvent(event);
      if (!anchor) return; // 移入卡片/正文：关闭计时由 pointerout 与卡片 onPointerEnter 管理
      window.clearTimeout(closeTimer.current);
      if (anchorRef.current === anchor && openRef.current) return;
      if (pendingAnchor.current === anchor) return;
      // 换了目标：清掉旧目标的等待与卡片，重新计时
      window.clearTimeout(openTimer.current);
      if (openRef.current) closeCard(false);
      pendingAnchor.current = anchor;
      openTimer.current = window.setTimeout(() => {
        pendingAnchor.current = null;
        openCard(anchor);
      }, HOVER_DELAY_MS);
    };

    const onPointerOut = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      const anchor = linkFromEvent(event);
      if (!anchor) return;
      const to = event.relatedTarget;
      if (to instanceof Node && (anchor.contains(to) || cardRef.current?.contains(to))) return;
      window.clearTimeout(openTimer.current);
      pendingAnchor.current = null;
      closeTimer.current = window.setTimeout(() => closeCard(false), CLOSE_GRACE_MS);
    };

    // 开始按压（选文、点击别处）即收起：卡片不得盖住选区工具条或其它操作；
    // 按压卡片内部（视角入口/查看全部）不收，保证其点击完整送达
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && cardRef.current?.contains(event.target)) return;
      window.clearTimeout(openTimer.current);
      pendingAnchor.current = null;
      if (openRef.current) closeCard(false);
    };

    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a.wiki-link");
      if (anchor && anchor.closest(".wiki-content")) {
        window.clearTimeout(closeTimer.current);
        // :focus-visible 区分键盘与点击跟随的焦点；触屏点击不开卡
        if (anchor.matches(":focus-visible") && anchorRef.current !== anchor) {
          openCard(anchor);
        }
        return;
      }
      if (openRef.current && !cardRef.current?.contains(event.target)) closeCard(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!openRef.current || event.defaultPrevented) return;
      if (event.key === "Escape") {
        // 焦点在本组件的链接/卡片上时才接管 Esc；别处的 Esc 语义不受影响
        const active = document.activeElement;
        const ownsFocus = active === anchorRef.current
          || (active instanceof Node && cardRef.current?.contains(active) === true);
        if (ownsFocus) event.preventDefault();
        closeCard(true);
        return;
      }
      if (event.key !== "Tab" || !cardRef.current) return;
      const focusables = Array.from(
        cardRef.current.querySelectorAll<HTMLElement>("a[href], button"),
      );
      if (focusables.length === 0) return;
      const active = document.activeElement;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (active === anchorRef.current && !event.shiftKey) {
        // Tab 从链接进入卡片：入口可键盘访问
        event.preventDefault();
        first.focus();
      } else if ((active === first && event.shiftKey) || (active === last && !event.shiftKey)) {
        // 卡片两端收尾：关闭并把焦点还给链接（回到正文自然 Tab 流）
        event.preventDefault();
        closeCard(true);
      }
    };

    const onReposition = () => {
      if (openRef.current && anchorRef.current) positionCard(anchorRef.current);
    };

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onReposition, { passive: true, capture: true });
    window.addEventListener("resize", onReposition);
    return () => {
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onReposition, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", onReposition);
      stopTimers();
    };
  }, [closeCard, openCard, positionCard, stopTimers]);

  // 内容就绪改变卡片高度后重新贴位
  useEffect(() => {
    if (card && anchorRef.current) positionCard(anchorRef.current);
  }, [card, positionCard]);

  if (!card || !pos) return null;

  const payload = card.status === "ready" ? card.payload : null;
  const viewAllHref = card.anchor.getAttribute("href") ?? "#";

  return createPortal(
    <div
      ref={cardRef}
      role="group"
      aria-label="双链预览"
      className="pw-link-preview fixed z-50 overflow-hidden rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
      style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: CARD_MAX_HEIGHT }}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
        window.clearTimeout(closeTimer.current);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
        // 移回链接会被 pointerover 兜住；这里只管离开链接+卡片后的延迟关闭
        closeTimer.current = window.setTimeout(() => closeCard(false), CLOSE_GRACE_MS);
      }}
    >
      {card.status === "loading" && <p className="text-sm text-muted-foreground">加载中…</p>}
      {card.status === "error" && <p className="text-sm text-muted-foreground">预览暂不可用</p>}
      {payload?.kind === "term" && (
        <>
          <p className="text-sm font-semibold leading-snug">{payload.title}</p>
          <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {payload.summary || "暂无简介"}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {payload.perspectives.map((entry) => (
              <a
                key={entry.href}
                href={entry.href}
                title={entry.title}
                className="text-primary underline-offset-2 hover:underline"
              >
                {entry.interpreterName}
              </a>
            ))}
            <a href={viewAllHref} className="text-primary underline-offset-2 hover:underline">
              查看全部
            </a>
          </div>
        </>
      )}
      {payload?.kind === "perspective" && (
        <>
          <p className="text-sm font-semibold leading-snug">{payload.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">诠释者：{payload.interpreterName}</p>
          <p className="mt-1.5 line-clamp-4 text-sm leading-relaxed [overflow-wrap:anywhere]">
            {payload.excerpt || "暂无正文"}
          </p>
        </>
      )}
    </div>,
    document.body,
  );
}

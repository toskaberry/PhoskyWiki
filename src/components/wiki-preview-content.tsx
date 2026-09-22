"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { pageIdFromKey } from "@/lib/slug";
import type { WikiPreview } from "@/lib/wiki-preview-types";

// Compact spacing fits a title in 40px, or a title and one detail row in 64px.
const MIN_CARD_HEIGHT = 40;
const MIN_DETAIL_HEIGHT = 64;

type PreviewState = {
  left: number;
  top: number;
  maxHeight: number;
  above: boolean;
  content: WikiPreview | "loading" | "error";
};

/** Keep the original body element intact: annotation offsets must never include the portal. */
export function WikiPreviewContent({ html }: { html: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [preview, setPreview] = useState<PreviewState | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let anchor: HTMLAnchorElement | null = null;
    let opening: ReturnType<typeof setTimeout> | undefined;
    let closing: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    let visible = false;
    let pointerInside = false;

    const within = (target: EventTarget | null) => target instanceof Node &&
      (!!anchor?.contains(target) || !!cardRef.current?.contains(target));
    const close = () => {
      clearTimeout(opening);
      opening = undefined;
      clearTimeout(closing);
      request?.abort();
      anchor?.removeAttribute("aria-controls");
      anchor?.removeAttribute("aria-expanded");
      anchor = null;
      visible = false;
      pointerInside = false;
      setPreview(null);
    };
    const scheduleClose = () => {
      clearTimeout(opening);
      opening = undefined;
      clearTimeout(closing);
      closing = setTimeout(() => {
        if (!pointerInside && !within(document.activeElement)) close();
      }, 180);
    };
    const locate = (link: HTMLAnchorElement) => {
      const rect = link.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 16);
      const bottom = Math.min(window.innerHeight, Math.max(0, rect.bottom));
      const topEdge = Math.min(window.innerHeight, Math.max(0, rect.top));
      const spaceBelow = Math.max(0, window.innerHeight - bottom - 16);
      const spaceAbove = Math.max(0, topEdge - 16);
      const above = spaceBelow < 280 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(280, above ? spaceAbove : spaceBelow);
      const top = above ? topEdge - 8 : bottom + 8;
      return {
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top, maxHeight, above,
      };
    };
    const reposition = () => {
      if (!anchor || !visible) return;
      const rect = anchor.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) {
        close();
        return;
      }
      const position = locate(anchor);
      if (position.maxHeight < MIN_CARD_HEIGHT) {
        close();
        return;
      }
      setPreview(current => current ? { ...current, ...position } : null);
    };
    const activate = (link: HTMLAnchorElement, delay: number) => {
      clearTimeout(closing);
      if (anchor === link && (opening || visible)) return;
      close();
      anchor = link;
      opening = setTimeout(async () => {
        opening = undefined;
        const pageId = pageIdFromKey(new URL(link.href).pathname.split("/").pop() ?? "");
        if (pageId === null) return;
        const position = locate(link);
        if (position.maxHeight < MIN_CARD_HEIGHT) {
          close();
          return;
        }
        visible = true;
        link.setAttribute("aria-controls", id);
        link.setAttribute("aria-expanded", "true");
        setPreview({ ...position, content: "loading" });
        const currentRequest = new AbortController();
        request = currentRequest;
        try {
          const response = await fetch(`/api/wiki-preview?pageId=${pageId}`, {
            cache: "no-store", signal: currentRequest.signal,
          });
          if (!response.ok) throw new Error("Preview unavailable");
          const content: WikiPreview = await response.json();
          if (!currentRequest.signal.aborted) setPreview(current => current ? { ...current, content } : null);
        } catch {
          if (!currentRequest.signal.aborted) setPreview(current => current ? { ...current, content: "error" } : null);
        }
      }, delay);
    };
    const findLink = (target: EventTarget | null) => {
      const link = target instanceof Element ? target.closest<HTMLAnchorElement>("a.wiki-link[href]") : null;
      return link && root.contains(link) ? link : null;
    };
    const onPointerOver = (event: PointerEvent) => {
      if ((event.pointerType !== "mouse" && event.pointerType !== "pen") || event.buttons !== 0) return;
      const link = findLink(event.target);
      if (link) activate(link, 650);
      if (within(event.target)) {
        pointerInside = true;
        clearTimeout(closing);
      }
    };
    const onPointerOut = (event: PointerEvent) => {
      if (!within(event.target) || within(event.relatedTarget)) return;
      pointerInside = false;
      scheduleClose();
    };
    // 开始选文或点击卡片外部时立即收起，避免遮挡选区工具条；卡内导航不受影响。
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && cardRef.current?.contains(event.target)) return;
      close();
    };
    const onFocusIn = (event: FocusEvent) => {
      const link = findLink(event.target);
      // Touch/click focus must not turn navigation into a preview gesture.
      if (link?.matches(":focus-visible")) activate(link, 0);
      if (within(event.target)) clearTimeout(closing);
      else if (anchor) scheduleClose();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (within(event.target) && !within(event.relatedTarget)) scheduleClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!anchor) return;
      if (event.key === "Escape") {
        if (cardRef.current?.contains(document.activeElement)) anchor.focus();
        close();
        return;
      }
      if (event.key !== "Tab" || !visible) return;
      const links = cardRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]");
      if (!links?.length) return;
      if (document.activeElement === anchor && !event.shiftKey) {
        event.preventDefault();
        links[0].focus();
      } else if (document.activeElement === links[0] && event.shiftKey) {
        event.preventDefault();
        anchor.focus();
      } else if (document.activeElement === links[links.length - 1] && !event.shiftKey) {
        // A body portal must resume the document's reading order after its source link.
        const focusable = Array.from(document.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        )).filter(element => !cardRef.current?.contains(element) && element.getClientRects().length > 0);
        const next = focusable[focusable.indexOf(anchor) + 1];
        if (next) {
          event.preventDefault();
          close();
          next.focus();
        }
      }
    };
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      close();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [html, id]);

  return <>
    <div ref={rootRef} className="wiki-content prose max-w-none"
      dangerouslySetInnerHTML={{ __html: html }} />
    {preview && createPortal(
      <div ref={cardRef} id={id} role="dialog" aria-label="双链预览"
        className="wiki-preview" data-compact={preview.maxHeight < 120 || undefined}
        style={{ left: preview.left, top: preview.top, maxHeight: preview.maxHeight, transform: preview.above ? "translateY(-100%)" : undefined }}>
        {typeof preview.content === "string" ? (
          <p role="status">{preview.content === "loading" ? "正在加载预览…" : "预览暂不可用"}</p>
        ) : <>
          <a className="wiki-preview-title" href={preview.content.href}>{preview.content.title}</a>
          {preview.content.type === "perspective" && preview.maxHeight >= MIN_DETAIL_HEIGHT && <p className="wiki-preview-interpreter">诠释者：{preview.content.interpreterName}</p>}
          {preview.maxHeight >= 120 && <p className="wiki-preview-excerpt">{preview.content.excerpt || (preview.content.type === "term" ? "暂无简介" : "暂无正文")}</p>}
          {preview.content.type === "term" && preview.content.perspectiveCount > 0 && preview.maxHeight >= MIN_DETAIL_HEIGHT && (
            <nav aria-label="视角入口" className="wiki-preview-perspectives">
              {(preview.maxHeight >= 180 ? preview.content.perspectives : []).map(perspective => <a key={perspective.href} href={perspective.href}>{perspective.title}</a>)}
              <a href={preview.content.href}>查看全部（{preview.content.perspectiveCount}）</a>
            </nav>
          )}
        </>}
      </div>, document.body,
    )}
  </>;
}

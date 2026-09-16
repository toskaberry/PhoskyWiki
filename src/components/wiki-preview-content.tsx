"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { pageIdFromKey } from "@/lib/slug";
import type { WikiPreview } from "@/lib/wiki-preview-types";

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
    const activate = (link: HTMLAnchorElement, delay: number) => {
      clearTimeout(closing);
      if (anchor === link && (opening || visible)) return;
      close();
      anchor = link;
      opening = setTimeout(async () => {
        opening = undefined;
        const pageId = pageIdFromKey(new URL(link.href).pathname.split("/").pop() ?? "");
        if (pageId === null) return;
        const rect = link.getBoundingClientRect();
        const width = Math.min(320, window.innerWidth - 16);
        const maxHeight = Math.min(280, window.innerHeight - 16);
        const below = rect.bottom + 8;
        const fitsBelow = below + maxHeight <= window.innerHeight - 8;
        const above = !fitsBelow && rect.top >= maxHeight + 8;
        const top = fitsBelow ? below : above ? rect.top - 8 : 8;
        const position = {
          left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
          top, maxHeight, above,
        };
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
          if (!currentRequest.signal.aborted) setPreview({ ...position, content });
        } catch {
          if (!currentRequest.signal.aborted) setPreview({ ...position, content: "error" });
        }
      }, delay);
    };
    const findLink = (target: EventTarget | null) => {
      const link = target instanceof Element ? target.closest<HTMLAnchorElement>("a.wiki-link[href]") : null;
      return link && root.contains(link) ? link : null;
    };
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.buttons !== 0) return;
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
          next.focus();
          close();
        }
      }
    };
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      close();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [html, id]);

  return <>
    <div ref={rootRef} className="wiki-content prose prose-zinc dark:prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: html }} />
    {preview && createPortal(
      <div ref={cardRef} id={id} role="dialog" aria-label="双链预览"
        className="wiki-preview" style={{ left: preview.left, top: preview.top, maxHeight: preview.maxHeight, transform: preview.above ? "translateY(-100%)" : undefined }}>
        {typeof preview.content === "string" ? (
          <p role="status">{preview.content === "loading" ? "正在加载预览…" : "预览暂不可用"}</p>
        ) : <>
          <a className="wiki-preview-title" href={preview.content.href}>{preview.content.title}</a>
          {preview.content.type === "perspective" && <p className="wiki-preview-interpreter">诠释者：{preview.content.interpreterName}</p>}
          <p className="wiki-preview-excerpt">{preview.content.excerpt || (preview.content.type === "term" ? "暂无简介" : "暂无正文")}</p>
          {preview.content.type === "term" && preview.content.perspectiveCount > 0 && (
            <nav aria-label="视角入口" className="wiki-preview-perspectives">
              {preview.content.perspectives.map(perspective => <a key={perspective.href} href={perspective.href}>{perspective.title}</a>)}
              <a href={preview.content.href}>查看全部（{preview.content.perspectiveCount}）</a>
            </nav>
          )}
        </>}
      </div>, document.body,
    )}
  </>;
}

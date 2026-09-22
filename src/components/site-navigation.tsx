"use client";

import { ChevronDown, Menu, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog, Popover } from "radix-ui";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { LogoutButton } from "@/components/logout-button";
import { NotificationLink } from "@/components/notification-link";
import { SearchBox } from "@/components/search-box";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { hasAdminRole, roleLabels } from "@/lib/roles";
import type { SessionUser } from "@/lib/session";

type NavigationUser = Pick<SessionUser, "id" | "name" | "role">;
type NavigationItem = { href: string; label: string };

const primaryItems = [
  { href: "/terms", label: "词条" },
  { href: "/interpreters", label: "诠释者" },
  { href: "/schools", label: "学派" },
  { href: "/graph", label: "图谱" },
];
const discoveryItems = [
  { href: "/categories", label: "分类" },
  { href: "/interests", label: "兴趣" },
  { href: "/search", label: "搜索" },
];
const accountItems = [
  { href: "/profile", label: "个人主页" },
  { href: "/profile#records-heading", label: "评论与感想" },
  { href: "/profile#submission-history-heading", label: "我的提交" },
  { href: "/profile#notifications", label: "通知" },
];
const creationItems = [
  { href: "/new/term", label: "创建词条" },
  { href: "/new/interpreter", label: "新诠释者" },
  { href: "/new/perspective", label: "新视角" },
];
const adminItems = [
  { href: "/review", label: "审核队列" },
  { href: "/admin/deleted", label: "已删除页面" },
  { href: "/admin/access", label: "邀请与恢复" },
  { href: "/admin/import", label: "导入内容" },
];
const guestItems = [
  { href: "/login", label: "登录" },
  { href: "/register", label: "注册" },
];

function NavigationLinks({ items, onNavigate }: {
  items: NavigationItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return items.map(({ href, label }) => (
    <Link
      key={href}
      href={href}
      onNavigate={onNavigate}
      aria-current={pathname === href ? "page" : undefined}
      className="flex min-h-11 min-w-0 items-center rounded px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted aria-[current=page]:bg-accent aria-[current=page]:font-semibold aria-[current=page]:text-primary"
    >
      {label}
    </Link>
  ));
}

function AccountLinks({ user, onNavigate }: {
  user: NavigationUser | null;
  onNavigate: () => void;
}) {
  if (!user) return <div className="grid grid-cols-2"><NavigationLinks items={guestItems} onNavigate={onNavigate} /></div>;

  return (
    <div className="space-y-3">
      <div className="border-b border-border px-3 pb-3">
        <p className="break-words font-medium [overflow-wrap:anywhere]">{user.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">{roleLabels[user.role]}</p>
      </div>
      <nav aria-label="个人任务" className="grid grid-cols-2">
        <NavigationLinks items={accountItems} onNavigate={onNavigate} />
      </nav>
      <nav aria-label="创建内容" className="grid grid-cols-2 border-t border-border pt-3">
        <NavigationLinks items={creationItems} onNavigate={onNavigate} />
      </nav>
      {hasAdminRole(user.role) && (
        <nav aria-label="管理入口" className="grid grid-cols-2 border-t border-border pt-3">
          <NavigationLinks items={adminItems} onNavigate={onNavigate} />
          {user.role === "superadmin" && <NavigationLinks items={[{ href: "/profile#user-management", label: "用户管理" }]} onNavigate={onNavigate} />}
        </nav>
      )}
      <div className="border-t border-border pt-3"><LogoutButton /></div>
    </div>
  );
}

function useNavigationDisclosure() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const navigating = useRef(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1280px)");
    const closeAtBreakpoint = () => setOpen(false);
    desktop.addEventListener("change", closeAtBreakpoint);
    return () => desktop.removeEventListener("change", closeAtBreakpoint);
  }, []);

  return {
    open,
    trigger,
    onOpenChange(value: boolean) { navigating.current = false; setOpen(value); },
    onNavigate() { navigating.current = true; setOpen(false); },
    onCloseAutoFocus(event: Event) {
      if (navigating.current) { event.preventDefault(); return; }
      // A breakpoint can hide the old trigger. The brand remains a visible entry.
      if (!trigger.current?.getClientRects().length) {
        event.preventDefault();
        document.getElementById("site-home-link")?.focus({ preventScroll: true });
      }
    },
  };
}

function NavigationPopover({ label, trigger, items, user = null }: {
  label: string;
  trigger: ReactNode;
  items?: NavigationItem[];
  user?: NavigationUser | null;
}) {
  const { open, trigger: triggerRef, onOpenChange, onNavigate, onCloseAutoFocus } = useNavigationDisclosure();
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger ref={triggerRef} asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label={label}
          align="end"
          sideOffset={8}
          className="z-50 max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded border border-border bg-popover p-4 text-popover-foreground shadow-lg"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          {items ? <NavigationLinks items={items} onNavigate={onNavigate} /> : <AccountLinks user={user} onNavigate={onNavigate} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function MobileNavigation({ user }: { user: NavigationUser | null }) {
  const { open, trigger: triggerRef, onOpenChange, onNavigate, onCloseAutoFocus } = useNavigationDisclosure();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <Button ref={triggerRef} variant="outline" aria-label="打开导航" className="size-11 xl:hidden"><Menu aria-hidden="true" /></Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/30" />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-border bg-background text-foreground shadow-xl"
          onCloseAutoFocus={event => {
            onCloseAutoFocus(event);
            if (!event.defaultPrevented) {
              event.preventDefault();
              triggerRef.current?.focus({ preventScroll: true });
            }
          }}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <Dialog.Title className="text-lg font-bold">站点导航</Dialog.Title>
            <Dialog.Close asChild><Button variant="ghost" aria-label="关闭导航" className="size-11"><X aria-hidden="true" /></Button></Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">浏览词条、诠释者、学派与图谱，管理你的阅读和贡献。</Dialog.Description>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <nav aria-label="主导航" className="grid grid-cols-2 gap-1">
              <NavigationLinks items={[...primaryItems, ...discoveryItems]} onNavigate={onNavigate} />
            </nav>
            <div className="my-4 flex items-center justify-between border-y border-border py-4">
              <span className="text-sm text-muted-foreground">阅读主题</span><ThemeToggle />
            </div>
            <AccountLinks user={user} onNavigate={onNavigate} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SiteNavigation({ user, unreadCount }: { user: NavigationUser | null; unreadCount: number }) {
  const pathname = usePathname();
  // Layouts persist across routes; menus belong to the current page and identity.
  const menuKey = `${pathname}:${user?.id ?? "guest"}:${user?.role ?? ""}`;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex min-h-16 w-full max-w-[88rem] items-center gap-2 px-4 sm:gap-4 sm:px-6 xl:gap-5">
        <Link id="site-home-link" href="/" className="mr-auto shrink-0 text-lg font-bold tracking-tight text-primary xl:mr-0">PhoskyWiki</Link>
        <nav aria-label="主导航" className="hidden shrink-0 items-center xl:flex">
          <NavigationLinks items={primaryItems} />
          <NavigationPopover key={pathname} label="更多导航" items={discoveryItems} trigger={<Button variant="ghost" aria-label="更多导航" className="min-h-11 text-muted-foreground">更多<ChevronDown aria-hidden="true" /></Button>} />
        </nav>
        <div className="ml-auto hidden min-w-0 max-w-xs flex-1 xl:block"><SearchBox /></div>
        <div className="hidden xl:block"><ThemeToggle /></div>
        <Link href="/search" aria-label="搜索" className="inline-flex size-11 shrink-0 items-center justify-center rounded text-foreground hover:bg-muted xl:hidden"><Search className="size-5" aria-hidden="true" /></Link>
        {user && <NotificationLink key={user.id} initialCount={unreadCount} compact />}
        <div className="hidden xl:block">
          <NavigationPopover key={menuKey} label="账户菜单" user={user} trigger={
            <Button variant="outline" aria-label="账户菜单" className="min-h-11 max-w-48">
              <span data-testid={user ? "session-user" : undefined} className="flex min-w-0 items-center gap-2">
                <span className="truncate">{user?.name ?? "登录 / 注册"}</span>
                {user && <span className="shrink-0 text-xs text-muted-foreground">{roleLabels[user.role]}</span>}
              </span>
              <ChevronDown aria-hidden="true" />
            </Button>
          } />
        </div>
        <MobileNavigation key={menuKey} user={user} />
      </div>
    </header>
  );
}

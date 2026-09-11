import { hasAdminRole, roleLabels } from "@/lib/roles";
import Link from "next/link";
import type { ReactNode } from "react";

import { LogoutButton } from "@/components/logout-button";
import { NotificationLink } from "@/components/notification-link";
import { SearchBox } from "@/components/search-box";
import { getUnreadNotificationCount } from "@/lib/notifications";
import { getSessionUser } from "@/lib/session";

const navItems = [
  { href: "/terms", label: "词条" },
  { href: "/interpreters", label: "诠释者" },
  { href: "/schools", label: "学派" },
  { href: "/categories", label: "分类" },
  { href: "/graph", label: "图谱" },
  { href: "/search", label: "搜索" },
  { href: "/interests", label: "兴趣" },
];


export async function SiteHeader() {
  const user = await getSessionUser();
  const unreadCount = user ? await getUnreadNotificationCount(user.id) : 0;

  return (
    <header className="z-40 border-b border-border bg-background/95 backdrop-blur lg:sticky lg:top-0">
      <div className="mx-auto flex min-h-14 w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
        <Link href="/" className="shrink-0 text-lg font-bold tracking-tight">
          PhoskyWiki
        </Link>
        <nav aria-label="主导航" className="order-last flex w-full flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
          {navItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="inline-flex min-h-10 items-center transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden sm:block sm:w-64">
          <SearchBox />
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2 text-sm">
          {user ? (
            <>
              <ButtonLikeLink href="/new/term">创建词条</ButtonLikeLink>
              <ButtonLikeLink href="/new/interpreter">新诠释者</ButtonLikeLink>
              {hasAdminRole(user.role) && <ButtonLikeLink href="/review">审核队列</ButtonLikeLink>}
              {hasAdminRole(user.role) && <ButtonLikeLink href="/admin/deleted">已删除页面</ButtonLikeLink>}
              {hasAdminRole(user.role) && <ButtonLikeLink href="/admin/access">邀请与恢复</ButtonLikeLink>}
              <NotificationLink key={user.id} initialCount={unreadCount} />
              <Link href="/profile" data-testid="session-user" className="min-w-0 break-words text-muted-foreground hover:text-foreground">
                {user.name}
                <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-xs">
                  {roleLabels[user.role]}
                </span>
              </Link>
              <LogoutButton />
            </>
          ) : (
            <>
              <ButtonLikeLink href="/login">登录</ButtonLikeLink>
              <ButtonLikeLink href="/register">注册</ButtonLikeLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function ButtonLikeLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </Link>
  );
}

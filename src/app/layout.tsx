import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource-variable/noto-serif-sc/wght.css";
import "./globals.css";

import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { WikiLinkPreviews } from "@/components/wiki-link-previews";
import { themeInitScript } from "@/lib/theme";

export const metadata: Metadata = {
  title: {
    default: "PhoskyWiki",
    template: "%s · PhoskyWiki",
  },
  description:
    "左翼哲学 / 政治经济学 / 历史领域的原子笔记 WIKI：每个词条聚合多个诠释者的视角。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full font-sans antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-4 focus:z-50 focus:rounded focus:bg-background focus:px-4 focus:py-3">跳到主要内容</a>
        <SiteHeader />
        <div id="main-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col">{children}</div>
        <SiteFooter />
        <WikiLinkPreviews />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource-variable/noto-serif-sc/wght.css";
import "./globals.css";

import { SiteHeader } from "@/components/site-header";
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
        <SiteHeader />
        <div className="flex flex-1 flex-col">{children}</div>
        <footer className="border-t border-border py-6 text-center text-sm text-muted-foreground">
          PhoskyWiki · 词条 × 视角的原子笔记 WIKI
        </footer>
      </body>
    </html>
  );
}

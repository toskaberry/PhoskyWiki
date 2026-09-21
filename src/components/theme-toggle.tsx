"use client";

import { Moon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { getServerTheme, getTheme, setTheme, subscribeTheme } from "@/lib/theme";

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);

  return (
    <Button
      type="button"
      variant="outline"
      aria-label="深色主题"
      aria-pressed={theme === "dark"}
      className="min-h-10 gap-1.5 dark:border-primary dark:bg-accent dark:text-primary"
      onClick={() => setTheme(getTheme() === "dark" ? "light" : "dark")}
    >
      <Moon aria-hidden="true" />
      深色
    </Button>
  );
}

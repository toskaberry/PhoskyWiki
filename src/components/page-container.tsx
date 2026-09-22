import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Shared page spacing; className can retain a route's reading or canvas width. */
export function PageContainer({ className, ...props }: ComponentProps<"main">) {
  return <main className={cn("mx-auto min-w-0 w-full max-w-5xl flex-1 px-4 py-8 sm:px-6", className)} {...props} />;
}

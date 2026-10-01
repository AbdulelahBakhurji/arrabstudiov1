import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

export function Surface({ children, className }: { children: ReactNode; className?: string }) {
  const hideYScroll = Boolean(className?.includes("overflow-hidden"));
  return (
    <div
      className={cn(
        "h-full min-h-0 min-w-0 overflow-x-hidden",
        hideYScroll ? "overflow-y-hidden" : "overflow-y-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}

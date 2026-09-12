import { Provider, Root, Trigger, Content, Portal } from "@radix-ui/react-tooltip";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const TooltipProvider = Provider;
export const Tooltip = Root;
export const TooltipTrigger = Trigger;

export function TooltipContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof Content>) {
  return (
    <Portal>
      <Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 rounded-md border border-white/10 bg-black px-2 py-1 text-xs text-white shadow-none",
          className,
        )}
        {...props}
      />
    </Portal>
  );
}

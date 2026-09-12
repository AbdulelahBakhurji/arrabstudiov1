import { Code2, MessageSquare } from "lucide-react";
import { ChevronLeft, ChevronRight, PanelLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import symbol from "@/assets/symbol.png";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function TitleBar({
  currentTitle,
  sidebarOpen,
  onToggleSidebar,
}: {
  currentTitle: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const navigate = useNavigate();

  return (
    <header
      data-tauri-drag-region
      className="flex h-[40px] shrink-0 items-center border-b border-white/8 bg-[#050505]"
    >
      <div className="w-[78px] shrink-0" aria-hidden="true" />
      <div className="titlebar-controls flex items-center gap-0.5">
        <TitleBarButton
          label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          onClick={onToggleSidebar}
        >
          <PanelLeft strokeWidth={1.6} />
        </TitleBarButton>
        <TitleBarButton label="Back" onClick={() => navigate(-1)}>
          <ChevronLeft strokeWidth={1.6} />
        </TitleBarButton>
        <TitleBarButton label="Forward" onClick={() => navigate(1)}>
          <ChevronRight strokeWidth={1.6} />
        </TitleBarButton>

        <div className="titlebar-controls ml-2 flex h-7 items-center gap-0.5 rounded-md border border-white/10 bg-white/[0.03] p-0.5">
          <span
            className="inline-flex size-6 items-center justify-center rounded-[5px] bg-white/10 text-white"
            title="Studio"
          >
            <MessageSquare className="size-3.5" strokeWidth={1.6} />
          </span>
          <span
            className="inline-flex size-6 items-center justify-center rounded-[5px] text-neutral-500"
            title="Code workspace — coming later"
          >
            <Code2 className="size-3.5" strokeWidth={1.6} />
          </span>
        </div>

        <div className="titlebar-controls ml-1.5 flex h-7 items-center rounded-md border border-white/10 bg-white/[0.04] px-2.5">
          <span className="text-[12px] text-neutral-300">{currentTitle}</span>
        </div>
      </div>
      <div className="flex-1" />
      <div className="titlebar-controls flex items-center gap-3 pr-3">
        <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-600">Phase 3</span>
        <img src={symbol} alt="" className="brand-mark size-4 object-contain opacity-90" />
      </div>
    </header>
  );
}

function TitleBarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={cn(
            "titlebar-controls inline-flex size-7 items-center justify-center rounded-md text-neutral-400",
            "hover:bg-white/8 hover:text-white",
            "[&_svg]:size-3.5",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, LoaderCircle, Wrench, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type AgentStepStatus = "running" | "done" | "failed" | "pending";

export type AgentStep = {
  id: string;
  title: string;
  detail?: string;
  status: AgentStepStatus;
};

function statusIcon(status: AgentStepStatus) {
  if (status === "running" || status === "pending") {
    return <LoaderCircle className="size-3.5 animate-spin text-neutral-400" strokeWidth={1.8} />;
  }
  if (status === "failed") {
    return <X className="size-3.5 text-red-300" strokeWidth={1.8} />;
  }
  return <Check className="size-3.5 text-emerald-300/90" strokeWidth={1.8} />;
}

export function friendlyToolTitle(name: string, detail?: string): string {
  const rawHint = detail?.split("\n")[0]?.trim() ?? "";
  const hint =
    rawHint && !rawHint.startsWith("{") && !rawHint.startsWith("[") && !rawHint.includes('"conversationId"')
      ? rawHint.replace(/^(?:File: |path[=:] ?|query: )/i, "").trim()
      : "";
  switch (name) {
    case "read_file":
      return hint ? `Reading ${hint}` : "Reading file";
    case "list_files":
      return hint ? `Listing ${hint}` : "Listing files";
    case "search_code":
      return hint ? `Searching ${hint}` : "Searching code";
    case "run_terminal":
      return hint ? `Running ${hint.slice(0, 64)}` : "Running command";
    case "write_file":
      return hint ? `Writing ${hint}` : "Writing file";
    case "apply_patch":
      return hint ? `Editing ${hint}` : "Editing file";
    case "summarize_workspace":
      return "Summarizing workspace";
    case "recall_goal":
      return "Checking goal";
    case "delete_file":
      return hint ? `Deleting ${hint}` : "Deleting file";
    case "rename_file":
      return hint ? `Renaming ${hint}` : "Renaming file";
    case "create_dir":
      return hint ? `Creating folder ${hint}` : "Creating folder";
    case "git_status":
      return "Checking git status";
    case "git_diff":
      return hint ? `Git diff ${hint}` : "Checking git diff";
    case "open_path":
      return hint ? `Opening ${hint}` : "Opening path";
    case "preview_html":
      return hint ? `HTML preview ${hint}` : "HTML preview";
    case "generate_pdf":
      return hint ? `Generating PDF ${hint}` : "Generating PDF";
    case "export_csv":
      return hint ? `Exporting CSV ${hint}` : "Exporting CSV";
    case "fetch_url":
      return hint ? `Fetching ${hint}` : "Fetching URL";
    case "scrape_page":
      return hint ? `Scraping ${hint}` : "Scraping page";
    case "web_search":
      return hint ? `Searching web ${hint}` : "Searching the web";
    case "list_email":
      return "Listing inbox";
    case "read_email":
      return "Reading email";
    case "send_email":
      return hint ? `Send email · ${hint.slice(0, 48)}` : "Send email";
    case "arrange_email":
      return hint ? `Arrange mail · ${hint.slice(0, 48)}` : "Arrange mail";
    default:
      return name.replace(/_/g, " ");
  }
}

export function AgentSteps({
  steps,
  thinkingLabel,
  emptyHidden = true,
}: {
  steps: AgentStep[];
  thinkingLabel: string;
  emptyHidden?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const visible = steps.filter(
    (step) => !(step.title === "thinking" && step.status === "done"),
  );
  if (visible.length === 0 && emptyHidden) return null;

  return (
    <div className="agent-steps rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <ul className="space-y-0.5">
        {visible.map((step) => {
          const expandable = Boolean(step.detail?.trim());
          const open = openId === step.id;
          return (
            <li key={step.id}>
              <button
                type="button"
                disabled={!expandable}
                onClick={() => setOpenId(open ? null : step.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-start transition-colors",
                  expandable ? "hover:bg-white/[0.04]" : "cursor-default",
                )}
              >
                <span className="flex size-5 shrink-0 items-center justify-center">
                  {statusIcon(step.status)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-300">
                  {step.title === "thinking" ? thinkingLabel : step.title}
                </span>
                {expandable ? (
                  open ? (
                    <ChevronDown className="size-3.5 shrink-0 text-neutral-600" strokeWidth={1.7} />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-neutral-600" strokeWidth={1.7} />
                  )
                ) : (
                  <Wrench className="size-3 shrink-0 text-neutral-700" strokeWidth={1.7} />
                )}
              </button>
              {open && step.detail ? (
                <pre className="mb-1 ms-7 max-h-36 overflow-y-auto whitespace-pre-wrap rounded-xl bg-black/35 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-neutral-500">
                  {step.detail}
                </pre>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

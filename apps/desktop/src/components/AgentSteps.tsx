import { Check, LoaderCircle, X } from "lucide-react";
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
  const short = hint.length > 56 ? `${hint.slice(0, 56).trim()}…` : hint;
  switch (name) {
    case "read_file":
      return short ? `Reading ${short}` : "Reading file";
    case "list_files":
      return short ? `Listing ${short}` : "Listing files";
    case "search_code":
      return short ? `Searching ${short}` : "Searching code";
    case "run_terminal":
      return short ? `Running ${short.slice(0, 64)}` : "Running command";
    case "write_file":
      return short ? `Writing ${short}` : "Writing file";
    case "apply_patch":
      return short ? `Editing ${short}` : "Editing file";
    case "summarize_workspace":
      return "Summarizing workspace";
    case "recall_goal":
      return "Checking goal";
    case "delete_file":
      return short ? `Deleting ${short}` : "Deleting file";
    case "rename_file":
      return short ? `Renaming ${short}` : "Renaming file";
    case "create_dir":
      return short ? `Creating folder ${short}` : "Creating folder";
    case "git_status":
      return "Checking git status";
    case "git_diff":
      return short ? `Reviewing git diff · ${short}` : "Checking git diff";
    case "open_path":
      return short ? `Opening ${short}` : "Opening path";
    case "preview_html":
      return short ? `Previewing HTML · ${short}` : "Previewing HTML";
    case "generate_pdf":
      return short ? `Generating PDF · ${short}` : "Generating PDF";
    case "generate_docx":
      return short ? `Creating Word doc · ${short}` : "Creating Word document";
    case "generate_presentation":
      return short ? `Building presentation · ${short}` : "Building presentation";
    case "generate_image":
      return short ? `Creating image · ${short}` : "Creating image";
    case "read_document":
      return short ? `Reading document · ${short}` : "Reading document";
    case "export_csv":
      return short ? `Exporting CSV · ${short}` : "Exporting CSV";
    case "fetch_url":
      return short ? `Fetching ${short}` : "Fetching URL";
    case "scrape_page":
      return short ? `Reading page · ${short}` : "Reading web page";
    case "web_search":
      return short ? `Searching the web for ${short}` : "Searching the web";
    case "list_email":
      return "Listing inbox";
    case "read_email":
      return "Reading email";
    case "send_email":
      return short ? `Sending email · ${short.slice(0, 48)}` : "Sending email";
    case "arrange_email":
      return short ? `Arranging mail · ${short.slice(0, 48)}` : "Arranging mail";
    default:
      return name.replace(/_/g, " ");
  }
}

/** Prefer the live step; otherwise the latest finished one. */
function pickActiveStep(steps: AgentStep[]): AgentStep | null {
  const visible = steps.filter(
    (step) => !(step.title === "thinking" && step.status === "done"),
  );
  if (visible.length === 0) return null;
  return (
    visible.find((step) => step.status === "running" || step.status === "pending") ??
    [...visible].reverse().find((step) => step.status === "failed") ??
    visible[visible.length - 1] ??
    null
  );
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
  const active = pickActiveStep(steps);
  if (!active && emptyHidden) return null;
  if (!active) return null;

  const label = active.title === "thinking" ? thinkingLabel : active.title;

  return (
    <div
      className={cn(
        "agent-steps agent-steps-line",
        "inline-flex max-w-full items-center gap-2 rounded-full border border-white/[0.06]",
        "bg-white/[0.02] px-3 py-1.5",
      )}
      role="status"
      aria-live="polite"
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {statusIcon(active.status)}
      </span>
      <span className="min-w-0 truncate text-[12.5px] text-neutral-300">{label}</span>
    </div>
  );
}

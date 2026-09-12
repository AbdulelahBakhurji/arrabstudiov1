import { useMemo, useState } from "react";
import { Copy, FileCode2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type Artifact = {
  id: string;
  language: string;
  title: string;
  content: string;
};

const FENCE_RE = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;

export function extractArtifacts(text: string): Artifact[] {
  const out: Artifact[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(FENCE_RE);
  let index = 0;
  while ((match = re.exec(text)) !== null) {
    const language = (match[1] || "text").toLowerCase();
    const content = (match[2] || "").trimEnd();
    if (content.length < 8) continue;
    index += 1;
    out.push({
      id: `art-${index}`,
      language,
      title: `${language || "snippet"} · ${index}`,
      content,
    });
  }
  return out.slice(0, 12);
}

type Props = {
  artifacts: Artifact[];
  className?: string;
  emptyLabel?: string;
  copyLabel?: string;
};

export function ArtifactsPanel({
  artifacts,
  className,
  emptyLabel = "Code blocks from replies appear here.",
  copyLabel = "Copy",
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo(
    () => artifacts.find((item) => item.id === activeId) ?? artifacts[0] ?? null,
    [activeId, artifacts],
  );

  if (artifacts.length === 0) {
    return (
      <div className={cn("rounded-2xl border border-white/[0.07] bg-black/30 p-4", className)}>
        <div className="flex items-center gap-2 text-[12px] text-neutral-500">
          <FileCode2 className="size-3.5" />
          {emptyLabel}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-col rounded-2xl border border-white/[0.07] bg-[#080808]", className)}>
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <FileCode2 className="size-3.5 text-neutral-400" />
        <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">Artifacts</p>
        <div className="ms-auto flex max-w-[60%] gap-1 overflow-x-auto">
          {artifacts.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveId(item.id)}
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                (active?.id ?? "") === item.id
                  ? "bg-white text-black"
                  : "border border-white/10 text-neutral-400",
              )}
            >
              {item.language || "text"}
            </button>
          ))}
        </div>
      </div>
      {active ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.04] px-3 py-1.5">
            <p className="truncate text-[11px] text-neutral-400">{active.title}</p>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(active.content)}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-neutral-300"
            >
              <Copy className="size-3" />
              {copyLabel}
            </button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-neutral-300">
            {active.content}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export function dismissableArtifactBar({
  onClose,
}: {
  onClose: () => void;
}) {
  return (
    <button type="button" onClick={onClose} className="text-neutral-500 hover:text-white">
      <X className="size-3.5" />
    </button>
  );
}

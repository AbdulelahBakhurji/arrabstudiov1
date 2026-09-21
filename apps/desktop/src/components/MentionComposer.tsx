import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Agent, WorkspaceMention } from "@arrab/shared";
import type { FsEntry } from "@/lib/fs";
import { readTextFile } from "@/lib/fs";
import { cn } from "@/lib/utils";

type MentionOption = {
  id: string;
  kind: WorkspaceMention["kind"];
  label: string;
  path?: string;
  agentId?: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  mentions: WorkspaceMention[];
  onMentionsChange: (mentions: WorkspaceMention[]) => void;
  agents: Agent[];
  files: FsEntry[];
  folderPath: string | null;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  className?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  onSubmit?: () => void;
};

export function MentionComposer({
  value,
  onChange,
  mentions,
  onMentionsChange,
  agents,
  files,
  folderPath,
  placeholder,
  disabled,
  rows = 3,
  className,
  textareaRef,
  onSubmit,
}: Props) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = textareaRef ?? localRef;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const mentionStart = useRef<number | null>(null);

  const options = useMemo(() => {
    const q = query.toLowerCase();
    const fileOpts: MentionOption[] = files
      .filter((entry) => entry.kind === "file")
      .slice(0, 80)
      .map((entry) => ({
        id: `file:${entry.path}`,
        kind: "file" as const,
        label: entry.path,
        path: entry.path,
      }));
    const folderOpts: MentionOption[] = files
      .filter((entry) => entry.kind === "dir")
      .slice(0, 40)
      .map((entry) => ({
        id: `folder:${entry.path}`,
        kind: "folder" as const,
        label: entry.path,
        path: entry.path,
      }));
    const agentOpts: MentionOption[] = agents.slice(0, 40).map((agent) => ({
      id: `agent:${agent.id}`,
      kind: "agent" as const,
      label: agent.name,
      agentId: agent.id,
    }));
    return [...fileOpts, ...folderOpts, ...agentOpts]
      .filter((item) => !q || item.label.toLowerCase().includes(q))
      .slice(0, 10);
  }, [agents, files, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  async function pick(option: MentionOption) {
    const start = mentionStart.current ?? value.length;
    const before = value.slice(0, start);
    const after = value.slice(start + 1 + query.length);
    const token = `@${option.label}`;
    onChange(`${before}${token} ${after}`);
    setOpen(false);
    setQuery("");
    mentionStart.current = null;

    let content: string | null = null;
    if (option.kind === "file" && option.path && folderPath) {
      try {
        const file = await readTextFile(folderPath, option.path);
        content = file.content.slice(0, 6000);
      } catch {
        content = null;
      }
    }
    const next: WorkspaceMention = {
      kind: option.kind,
      label: option.label,
      path: option.path ?? null,
      content,
      agentId: option.agentId ?? null,
    };
    const deduped = [
      next,
      ...mentions.filter(
        (item) => !(item.kind === next.kind && item.label === next.label),
      ),
    ].slice(0, 8);
    onMentionsChange(deduped);
    requestAnimationFrame(() => ref.current?.focus());
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (open && options.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % options.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + options.length) % options.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void pick(options[activeIndex]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !open) {
      event.preventDefault();
      onSubmit?.();
    }
  }

  function handleChange(next: string) {
    onChange(next);
    const el = ref.current;
    const caret = el?.selectionStart ?? next.length;
    const upto = next.slice(0, caret);
    const at = upto.lastIndexOf("@");
    if (at >= 0) {
      const fragment = upto.slice(at + 1);
      if (!/\s/.test(fragment) && fragment.length <= 48) {
        mentionStart.current = at;
        setQuery(fragment);
        setOpen(true);
        return;
      }
    }
    setOpen(false);
    setQuery("");
    mentionStart.current = null;
  }

  return (
    <div className="relative">
      {mentions.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {mentions.map((mention) => (
            <button
              key={`${mention.kind}:${mention.label}`}
              type="button"
              onClick={() =>
                onMentionsChange(
                  mentions.filter(
                    (item) => !(item.kind === mention.kind && item.label === mention.label),
                  ),
                )
              }
              className="rounded-full border border-white/12 bg-white/[0.04] px-2 py-0.5 text-[10px] text-neutral-300"
            >
              @{mention.label} ×
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        ref={ref}
        value={value}
        disabled={disabled}
        rows={rows}
        placeholder={placeholder}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={onKeyDown}
        className={cn("field min-h-[72px] resize-none", className)}
      />
      {open && options.length > 0 ? (
        <ul className="absolute bottom-[calc(100%+6px)] start-0 z-20 max-h-56 w-full overflow-y-auto rounded-2xl border border-white/12 bg-[var(--color-surface)] p-1.5 shadow-2xl">
          {options.map((option, index) => (
            <li key={option.id}>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  void pick(option);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-start text-[12px]",
                  index === activeIndex ? "bg-white text-black" : "text-neutral-300 hover:bg-white/5",
                )}
              >
                <span className="truncate">{option.label}</span>
                <span
                  className={cn(
                    "shrink-0 text-[10px] uppercase tracking-[0.12em]",
                    index === activeIndex ? "text-black/60" : "text-neutral-600",
                  )}
                >
                  {option.kind}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

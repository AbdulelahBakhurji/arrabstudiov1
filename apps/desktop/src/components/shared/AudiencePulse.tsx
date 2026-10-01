import { cn } from "@/lib/utils";

export type PulseItem = {
  id: string;
  label: string;
  value: string | number;
  tone?: "default" | "warn" | "ok" | "live";
};

export function AudiencePulse({
  items,
  className,
}: {
  items: PulseItem[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={cn("aud-pulse", className)} role="list">
      {items.map((item) => (
        <div
          key={item.id}
          className={cn("aud-pulse-item", item.tone && `is-${item.tone}`)}
          role="listitem"
        >
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export function FaceStatusDot({
  tone,
  label,
}: {
  tone: "warn" | "quiet" | "ok";
  label: string;
}) {
  return (
    <em className={cn("aud-face-dot", `is-${tone}`)} title={label} aria-label={label} />
  );
}

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCircle2, Info, X, AlertTriangle } from "lucide-react";
import {
  subscribeToasts,
  type StudioToast,
  markNotificationRead,
} from "@/lib/notify";
import { cn } from "@/lib/utils";

function toneIcon(tone: StudioToast["tone"]) {
  if (tone === "success") return CheckCircle2;
  if (tone === "warn" || tone === "approval") return AlertTriangle;
  return Info;
}

export function ToastHost() {
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<StudioToast[]>([]);

  useEffect(() => {
    return subscribeToasts((toast) => {
      setToasts((current) => {
        const withoutDup = current.filter((item) => item.id !== toast.id);
        return [...withoutDup.slice(-4), toast];
      });
      if (toast.sticky) return;
      const ms = toast.durationMs ?? 5200;
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, ms);
    });
  }, []);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-4 end-4 z-[80] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2.5">
      {toasts.map((toast) => {
        const Icon = toast.kind === "approvals" ? Bell : toneIcon(toast.tone);
        return (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto relative overflow-hidden rounded-2xl border px-4 py-3 text-start shadow-2xl backdrop-blur transition",
              toast.tone === "approval" || toast.tone === "warn"
                ? "border-amber-400/35 bg-[color-mix(in_srgb,var(--color-surface)_78%,#f59e0b_22%)] text-amber-50"
                : toast.tone === "success"
                  ? "border-emerald-400/30 bg-[color-mix(in_srgb,var(--color-surface)_82%,var(--color-success)_18%)] text-emerald-50"
                  : "border-white/15 bg-[var(--color-surface)]/95 text-white",
            )}
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/20">
                <Icon size={15} strokeWidth={1.8} />
              </span>
              <button
                type="button"
                className="min-w-0 flex-1 text-start"
                onClick={() => {
                  markNotificationRead(toast.id);
                  if (toast.href) navigate(toast.href);
                  setToasts((current) => current.filter((item) => item.id !== toast.id));
                }}
              >
                <p className="text-[13px] font-semibold leading-snug">{toast.title}</p>
                {toast.body ? (
                  <p className="mt-1 text-[11.5px] leading-snug opacity-75">{toast.body}</p>
                ) : null}
                {toast.sticky ? (
                  <p className="mt-2 text-[10px] uppercase tracking-[0.12em] opacity-55">
                    Tap to open · stays until dismissed
                  </p>
                ) : null}
              </button>
              <button
                type="button"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-black/15 text-white/70 hover:bg-black/25 hover:text-white"
                aria-label="Dismiss"
                onClick={() => {
                  markNotificationRead(toast.id);
                  setToasts((current) => current.filter((item) => item.id !== toast.id));
                }}
              >
                <X size={13} />
              </button>
            </div>
            {!toast.sticky ? (
              <span
                className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-white/25"
                style={{
                  animation: `arrab-toast-meter ${toast.durationMs ?? 5200}ms linear forwards`,
                }}
              />
            ) : null}
          </div>
        );
      })}
      <style>{`@keyframes arrab-toast-meter { from { transform: scaleX(1); } to { transform: scaleX(0); } }`}</style>
    </div>
  );
}

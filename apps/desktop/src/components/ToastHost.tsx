import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { subscribeToasts, type StudioToast } from "@/lib/notify";
import { cn } from "@/lib/utils";

export function ToastHost() {
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<StudioToast[]>([]);

  useEffect(() => {
    return subscribeToasts((toast) => {
      setToasts((current) => [...current.slice(-4), toast]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, 5200);
    });
  }, []);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-4 end-4 z-[80] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={cn(
            "pointer-events-auto rounded-2xl border px-4 py-3 text-start shadow-2xl backdrop-blur transition",
            toast.tone === "warn"
              ? "border-amber-400/30 bg-[#1a1408]/90 text-amber-50"
              : toast.tone === "success"
                ? "border-emerald-400/25 bg-[#08140f]/90 text-emerald-50"
                : "border-white/15 bg-[#0c0c0c]/95 text-white",
          )}
          onClick={() => {
            if (toast.href) {
              navigate(toast.href);
            }
            setToasts((current) => current.filter((item) => item.id !== toast.id));
          }}
        >
          <p className="text-sm font-medium">{toast.title}</p>
          {toast.body ? <p className="mt-1 text-xs opacity-70">{toast.body}</p> : null}
        </button>
      ))}
    </div>
  );
}

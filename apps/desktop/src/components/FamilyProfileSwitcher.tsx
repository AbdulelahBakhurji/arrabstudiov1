import { useMemo, useState } from "react";
import { ChevronDown, UserRound } from "lucide-react";
import type { FamilyMemberPublic } from "@arrab/shared";
import { useFamilyProfile } from "@/lib/use-family-profile";
import { useLanguage } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

export function FamilyProfileSwitcher({ className }: { className?: string }) {
  const { t } = useLanguage();
  const { snapshot, active, switchTo, isChild } = useFamilyProfile();
  const [open, setOpen] = useState(false);
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pin, setPin] = useState("");

  const members = useMemo(() => snapshot?.members ?? [], [snapshot?.members]);

  if (!snapshot?.available || members.length === 0) return null;

  async function pick(member: FamilyMemberPublic) {
    if (member.id === active?.id) {
      setOpen(false);
      return;
    }
    if (member.hasPin) {
      setPinFor(member.id);
      setPin("");
      return;
    }
    const ok = await switchTo(member);
    if (ok) setOpen(false);
  }

  async function unlock() {
    const member = members.find((m) => m.id === pinFor);
    if (!member) return;
    const ok = await switchTo(member, pin);
    if (ok) {
      setPinFor(null);
      setPin("");
      setOpen(false);
    }
  }

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        className="flex max-w-[11rem] items-center gap-1.5 rounded-full border border-black/10 bg-white/80 px-2.5 py-1 text-xs font-medium text-neutral-800 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/10 dark:text-white"
        onClick={() => setOpen((v) => !v)}
        title={t("familySwitch")}
      >
        <span
          className="grid size-5 place-items-center rounded-full text-[10px] text-white"
          style={{ background: active?.color ?? "#7C6A4E" }}
        >
          {(active?.displayName ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <span className="truncate">{active?.displayName ?? t("familyHousehold")}</span>
        {isChild ? (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] text-amber-800">
            {t("familyKidMode")}
          </span>
        ) : null}
        <ChevronDown className="size-3 opacity-60" strokeWidth={1.8} />
      </button>

      {open ? (
        <div className="absolute end-0 top-[calc(100%+6px)] z-50 w-64 rounded-xl border border-black/10 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-neutral-950">
          <p className="px-2 pb-1.5 text-[10px] uppercase tracking-wide text-neutral-500">
            {t("familySwitchProfile")}
          </p>
          <ul className="max-h-64 space-y-0.5 overflow-auto">
            {members.map((member) => (
              <li key={member.id}>
                <button
                  type="button"
                  disabled={member.isPaused}
                  onClick={() => void pick(member)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start text-sm hover:bg-neutral-100 dark:hover:bg-white/10",
                    member.id === active?.id && "bg-neutral-100 dark:bg-white/10",
                    member.isPaused && "opacity-40",
                  )}
                >
                  <span
                    className="grid size-7 place-items-center rounded-full text-white"
                    style={{ background: member.color }}
                  >
                    <UserRound className="size-3.5" strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{member.displayName}</span>
                    <span className="block text-[11px] text-neutral-500">
                      {member.role}
                      {member.isPaused ? ` · ${t("familyPaused")}` : ""}
                      {member.hasPin ? " · PIN" : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {pinFor ? (
            <div className="mt-2 flex gap-1.5 border-t border-black/5 pt-2 dark:border-white/10">
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder={t("familyPinPlaceholder")}
                className="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                className="rounded-lg bg-neutral-900 px-2.5 py-1.5 text-xs text-white dark:bg-white dark:text-neutral-900"
                disabled={pin.length < 4}
                onClick={() => void unlock()}
              >
                {t("familyUnlock")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

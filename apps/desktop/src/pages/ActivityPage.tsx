import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import type { Activity } from "@arrab/shared";
import { Surface } from "@/components/StudioFrame";
import { useLanguage } from "@/i18n/LanguageProvider";
import { arrabApi, ApiRequestError } from "@/lib/api";

export function ActivityPage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    void arrabApi
      .activity()
      .then((response) => setItems(response.items))
      .catch((err: unknown) => {
        setItems(null);
        setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      });
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Surface>
      <div className="mx-auto max-w-[960px] px-6 py-8 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">{t("activity")}</p>
            <h1 className="mt-1 text-2xl text-white">{t("activityTitle")}</h1>
            <p className="mt-2 text-sm text-neutral-500">{t("activityBody")}</p>
          </div>
          <Link
            to="/workforce"
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-3 text-xs text-neutral-300"
          >
            {t("ccReports")}
            <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
        {error ? (
          <div className="mt-6 rounded-2xl border border-white/15 p-4">
            <p className="text-sm text-white">{t("apiUnavailable")}</p>
            <p className="mt-1 text-sm text-neutral-500">{error}</p>
            <button
              type="button"
              onClick={load}
              className="mt-3 h-8 rounded-md border border-white/20 px-3 text-xs text-white"
            >
              {t("retry")}
            </button>
          </div>
        ) : null}
        {items && items.length === 0 ? (
          <p className="mt-8 text-sm text-neutral-500">{t("quiet")}</p>
        ) : null}
        {items && items.length > 0 ? (
          <ol className="mt-8 space-y-4 border-s border-white/10 ps-5">
            {items.map((entry) => (
              <li key={entry.id}>
                <p className="text-sm text-white">{entry.summary}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  {entry.verb} · {entry.objectType}
                </p>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </Surface>
  );
}

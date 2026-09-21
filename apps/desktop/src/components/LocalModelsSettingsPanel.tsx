import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { markGettingStartedStep } from "@/lib/getting-started";
import {
  DEFAULT_OLLAMA_BASE,
  LOCAL_TIER_ORDER,
  fetchOllamaStatus,
  isCatalogModelInstalled,
  modelsByTier,
  pullOllamaModel,
  type LocalModelCatalogEntry,
  type LocalModelTier,
  type OllamaStatus,
} from "@/lib/local-models";
import { openExternalUrl } from "@/lib/desktop";
import { pushToast } from "@/lib/notify";
import { readPrefs, updatePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";

type TierFilter = "all" | LocalModelTier;

export function LocalModelsSettingsPanel() {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const [prefs, setPrefs] = useState(() => readPrefs());
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [busyTag, setBusyTag] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, { percent: number | null; status: string }>>(
    {},
  );
  const [scanning, setScanning] = useState(false);
  const [query, setQuery] = useState("");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    setScanning(true);
    const next = await fetchOllamaStatus(prefs.aiLocalBaseUrl || DEFAULT_OLLAMA_BASE);
    setStatus(next);
    setScanning(false);
  }, [prefs.aiLocalBaseUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function selectModel(entry: LocalModelCatalogEntry) {
    const installed = isCatalogModelInstalled(entry.ollamaTag, status?.models ?? []);
    if (!installed) {
      pushToast({
        title: ar ? "حمّل النموذج أولاً" : "Download the model first",
        tone: "warn",
      });
      return;
    }
    const next = updatePrefs({
      aiLocalEnabled: true,
      aiLocalModel: entry.ollamaTag,
    });
    setPrefs(next);
    markGettingStartedStep("local_model", true);
    pushToast({
      title: ar ? "تم اختيار النموذج المحلي" : "Local model selected",
      body: entry.ollamaTag,
      tone: "success",
    });
  }

  function clearSelection() {
    const next = updatePrefs({
      aiLocalEnabled: false,
      aiLocalModel: "",
    });
    setPrefs(next);
    pushToast({
      title: ar ? "تم إيقاف النموذج المحلي" : "Local model cleared",
      tone: "info",
    });
  }

  async function downloadModel(entry: LocalModelCatalogEntry) {
    if (!status?.online) {
      pushToast({
        title: ar ? "Ollama غير متصل" : "Ollama is offline",
        body: ar
          ? "ثبّت Ollama وشغّله ثم أعد المحاولة"
          : "Install and run Ollama, then try again",
        tone: "warn",
      });
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusyTag(entry.ollamaTag);
    setProgress((current) => ({
      ...current,
      [entry.ollamaTag]: { percent: 0, status: "starting" },
    }));
    try {
      await pullOllamaModel(entry.ollamaTag, {
        baseUrl: prefs.aiLocalBaseUrl,
        signal: controller.signal,
        onProgress: (row) => {
          setProgress((current) => ({
            ...current,
            [entry.ollamaTag]: { percent: row.percent, status: row.status },
          }));
        },
      });
      await refresh();
      pushToast({
        title: ar ? "اكتمل التحميل" : "Download complete",
        body: entry.ollamaTag,
        tone: "success",
      });
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        pushToast({
          title: ar ? "تم إلغاء التحميل" : "Download cancelled",
          body: entry.ollamaTag,
          tone: "info",
        });
      } else {
        pushToast({
          title: ar ? "فشل التحميل" : "Download failed",
          body: error instanceof Error ? error.message : undefined,
          tone: "warn",
        });
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setBusyTag(null);
    }
  }

  function cancelDownload() {
    abortRef.current?.abort();
  }

  const groups = modelsByTier();
  const selected = prefs.aiLocalEnabled ? prefs.aiLocalModel.trim() : "";
  const installedCount = useMemo(() => {
    const installed = status?.models ?? [];
    return groups
      .flatMap((group) => group.items)
      .filter((entry) => isCatalogModelInstalled(entry.ollamaTag, installed)).length;
  }, [groups, status?.models]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .filter((group) => tierFilter === "all" || group.tier === tierFilter)
      .map((group) => ({
        ...group,
        items: group.items.filter((entry) => {
          if (!q) return true;
          const hay = `${entry.name} ${entry.nameAr} ${entry.ollamaTag} ${entry.blurb} ${entry.blurbAr}`.toLowerCase();
          return hay.includes(q);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, query, tierFilter]);

  const tierFilters: Array<{ id: TierFilter; label: string }> = [
    { id: "all", label: t("localModelsFilterAll") },
    ...LOCAL_TIER_ORDER.map((tier) => ({
      id: tier as TierFilter,
      label: t(
        tier === "low"
          ? "localModelsTierLow"
          : tier === "mid"
            ? "localModelsTierMid"
            : tier === "high"
              ? "localModelsTierHigh"
              : "localModelsTierMax",
      ),
    })),
  ];

  return (
    <section className="settings-rise sg lm">
      <header className="sg-head">
        <div>
          <h2>{t("settingsLocalModels")}</h2>
          <p>{t("settingsLocalModelsBody")}</p>
        </div>
      </header>

      <article className="sg-panel">
        <div className="lm-runtime">
          <div className="lm-runtime-copy">
            <p className="sg-kicker">{t("localModelsRuntime")}</p>
            <div className="lm-status-row">
              <span
                className={cn("lm-dot", status?.online ? "is-on" : "is-off")}
                aria-hidden
              />
              <strong>
                {status?.online
                  ? t("localModelsOnline").replace("{version}", status.version || "Ollama")
                  : t("localModelsOffline")}
              </strong>
            </div>
            <p className="sg-body">
              {status?.online
                ? t("localModelsInstalledCount").replace("{count}", String(installedCount))
                : t("localModelsOfflineHint")}
            </p>
          </div>
          <div className="sg-actions">
            <button
              type="button"
              onClick={() => void openExternalUrl("https://ollama.com/download")}
              className="sg-ghost"
            >
              {t("localModelsInstallOllama")}
            </button>
            <button
              type="button"
              disabled={scanning}
              onClick={() => void refresh()}
              className="sg-cta"
            >
              {scanning ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {t("refresh")}
            </button>
          </div>
        </div>

        <label className="lm-url">
          <span className="sg-kicker">{t("localModelsBaseUrl")}</span>
          <input
            value={prefs.aiLocalBaseUrl}
            onChange={(event) => {
              const next = updatePrefs({
                aiLocalBaseUrl: event.target.value.trim() || DEFAULT_OLLAMA_BASE,
              });
              setPrefs(next);
            }}
            onBlur={() => void refresh()}
            className="field font-mono text-xs"
            placeholder={DEFAULT_OLLAMA_BASE}
            spellCheck={false}
            autoComplete="off"
          />
          <span className="sg-body">{t("localModelsBaseUrlHint")}</span>
        </label>
      </article>

      {selected ? (
        <article className="lm-active">
          <div className="lm-active-copy">
            <HardDrive className="size-4 shrink-0" strokeWidth={1.8} />
            <div>
              <p className="sg-kicker">{t("localModelsSelected")}</p>
              <code>{selected}</code>
            </div>
          </div>
          <button type="button" className="sg-ghost" onClick={clearSelection}>
            {t("localModelsClear")}
          </button>
        </article>
      ) : null}

      <article className="sg-panel">
        <div className="lm-toolbar">
          <label className="lm-search">
            <Search className="size-3.5 shrink-0 opacity-60" strokeWidth={1.8} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("localModelsSearch")}
              className="field"
            />
            {query ? (
              <button
                type="button"
                className="lm-clear-query"
                onClick={() => setQuery("")}
                aria-label={t("clear")}
              >
                <X className="size-3.5" strokeWidth={1.8} />
              </button>
            ) : null}
          </label>
          <div className="lm-tiers">
            {tierFilters.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn("lm-tier", tierFilter === item.id && "is-on")}
                onClick={() => setTierFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {filteredGroups.length === 0 ? (
          <p className="sg-body">{t("localModelsEmpty")}</p>
        ) : (
          <div className="lm-groups">
            {filteredGroups.map((group) => (
              <div key={group.tier} className="lm-group">
                <p className="sg-kicker">{ar ? group.labelAr : group.labelEn}</p>
                <div className="lm-cards">
                  {group.items.map((entry) => {
                    const installed = isCatalogModelInstalled(
                      entry.ollamaTag,
                      status?.models ?? [],
                    );
                    const isSelected = selected === entry.ollamaTag;
                    const downloading = busyTag === entry.ollamaTag;
                    const row = progress[entry.ollamaTag];
                    const pct = row?.percent ?? null;
                    return (
                      <div
                        key={entry.id}
                        className={cn(
                          "lm-card",
                          isSelected && "is-selected",
                          downloading && "is-busy",
                        )}
                      >
                        <div className="lm-card-main">
                          <div className="lm-card-title">
                            <h3>{ar ? entry.nameAr : entry.name}</h3>
                            {entry.recommended ? (
                              <span className="lm-badge">{t("localModelsRecommended")}</span>
                            ) : null}
                            {installed ? (
                              <span className="lm-badge is-ok">
                                <Check className="size-3" strokeWidth={2} />
                                {t("localModelsDownloaded")}
                              </span>
                            ) : null}
                          </div>
                          <p className="sg-body">{ar ? entry.blurbAr : entry.blurb}</p>
                          <div className="lm-meta">
                            <span>{entry.ollamaTag}</span>
                            <span>{entry.params}</span>
                            <span>{entry.sizeLabel}</span>
                          </div>
                          {downloading ? (
                            <div className="lm-progress">
                              <div className="lm-progress-track" aria-hidden>
                                <div
                                  className="lm-progress-fill"
                                  style={{
                                    width:
                                      pct == null
                                        ? "28%"
                                        : `${Math.max(pct > 0 ? 4 : 0, pct)}%`,
                                  }}
                                />
                              </div>
                              <div className="lm-progress-labels">
                                <span>{row?.status || t("localModelsDownloading")}</span>
                                <strong>{pct == null ? "…" : `${pct}%`}</strong>
                              </div>
                            </div>
                          ) : null}
                        </div>
                        <div className="lm-card-actions">
                          {!installed ? (
                            downloading ? (
                              <button
                                type="button"
                                onClick={cancelDownload}
                                className="sg-ghost is-danger"
                              >
                                {t("localModelsCancel")}
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={Boolean(busyTag) || !status?.online}
                                onClick={() => void downloadModel(entry)}
                                className="sg-cta"
                              >
                                <Download className="size-3.5" strokeWidth={1.9} />
                                {t("localModelsDownload")}
                              </button>
                            )
                          ) : (
                            <button
                              type="button"
                              onClick={() => selectModel(entry)}
                              className={isSelected ? "sg-cta" : "sg-ghost"}
                            >
                              {isSelected ? t("localModelsUsing") : t("localModelsUse")}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}

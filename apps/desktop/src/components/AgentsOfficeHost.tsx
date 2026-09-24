import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, TriangleAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "@/lib/terminal";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";
import { cn } from "@/lib/utils";
import { arrabApi } from "@/lib/api";
import { connectorLabel } from "@/lib/connector-catalog";

export type OfficeDepartmentSync = {
  id: string;
  name: string;
  agents: Array<{
    id: string;
    name: string;
    role?: string | null;
    specialty?: string | null;
  }>;
};

export type OfficeConnectorSync = {
  id: string;
  provider: string;
  name: string;
  status?: string;
};

type Props = {
  onBack?: () => void;
  departments?: OfficeDepartmentSync[];
};

const OFFICE_URL = "http://127.0.0.1:4520";

async function probeOffice(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/health`, { method: "GET", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

async function syncOfficeRoster(
  base: string,
  departments: OfficeDepartmentSync[],
  connectors: OfficeConnectorSync[],
): Promise<void> {
  await fetch(`${base}/api/arrab/sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ departments, connectors }),
  });
}

async function officeChatReply(opts: {
  agentId?: string | null;
  teamId?: string | null;
  text: string;
}): Promise<string> {
  const agentId = opts.agentId?.trim() || "";
  const teamId = opts.teamId?.trim() || "";
  const text = opts.text.trim();
  if (!text) throw new Error("empty");

  if (teamId) {
    const listed = await arrabApi.conversations().catch(() => ({ items: [] }));
    let conversation =
      listed.items?.find((item) => item.teamId === teamId) ?? null;
    if (!conversation) {
      conversation = await arrabApi.createConversation({
        teamId,
        title: "Office chat",
        spend: { tier: "low" },
      });
    }
    const result = await arrabApi.sendMessage(conversation.id, { content: text });
    return result.assistantMessage?.content?.trim() || "…";
  }

  if (!agentId) throw new Error("missing-agent");
  const listed = await arrabApi.agentConversations(agentId).catch(() => ({ items: [] }));
  let conversation = listed.items?.[0] ?? null;
  if (!conversation) {
    conversation = await arrabApi.createConversation({
      agentId,
      title: "Office chat",
      spend: { tier: "low" },
    });
  }
  const result = await arrabApi.sendMessage(conversation.id, { content: text });
  return result.assistantMessage?.content?.trim() || "…";
}

export function AgentsOfficeHost({ onBack, departments = [] }: Props) {
  const { t, locale } = useLanguage();
  const { href } = useRole();
  const navigate = useNavigate();
  const ar = locale === "ar";
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [connectors, setConnectors] = useState<OfficeConnectorSync[]>([]);
  const rosterKey = useMemo(
    () =>
      JSON.stringify({
        departments: departments.map((dept) => ({
          id: dept.id,
          name: dept.name,
          agents: dept.agents.slice(0, 8).map((agent) => ({
            id: agent.id,
            name: agent.name,
            role: agent.role ?? null,
            specialty: agent.specialty ?? null,
          })),
        })),
        connectors,
      }),
    [connectors, departments],
  );

  useEffect(() => {
    const onMsg = (event: MessageEvent) => {
      // Only accept messages from the local Agents Office iframe.
      if (event.origin !== OFFICE_URL) return;
      const data = event?.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "arrab:open-connectors") {
        navigate(href("/connectors"));
        return;
      }

      if (data.type === "arrab:office-chat") {
        const id = String(data.id || "");
        const agentId = String(data.agentId || "");
        const teamId = String(data.teamId || "");
        const text = String(data.text || "").trim();
        const source = iframeRef.current?.contentWindow;
        const reply = (payload: { reply?: string; error?: string }) => {
          try {
            source?.postMessage({ type: "arrab:office-chat-reply", id, ...payload }, OFFICE_URL);
          } catch {
            /* iframe gone */
          }
        };
        if (!id || !text || (!agentId && !teamId)) {
          reply({ error: "missing-chat" });
          return;
        }
        void officeChatReply({ agentId: agentId || null, teamId: teamId || null, text })
          .then((answer) => reply({ reply: answer }))
          .catch((err: unknown) =>
            reply({ error: err instanceof Error ? err.message : "chat-failed" }),
          );
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [href, navigate]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await arrabApi.connectors();
        if (!alive) return;
        setConnectors(
          (res.items ?? []).map((c) => ({
            id: c.id,
            provider: c.provider,
            name: connectorLabel(c.provider, ar) || c.accountLabel || c.provider,
            status: c.status,
          })),
        );
      } catch {
        if (alive) setConnectors([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ar]);

  useEffect(() => {
    let alive = true;
    const payload = JSON.parse(rosterKey) as {
      departments: OfficeDepartmentSync[];
      connectors: OfficeConnectorSync[];
    };
    (async () => {
      setBusy(true);
      setError(null);
      try {
        let base = OFFICE_URL;
        if (isTauriRuntime()) {
          base = await invoke<string>("ensure_agents_office");
        } else if (!(await probeOffice(OFFICE_URL))) {
          throw new Error("Start Agents Office first: cd apps/agents-office && npm start");
        }
        if (!alive) return;
        try {
          await syncOfficeRoster(base, payload.departments, payload.connectors);
        } catch {
          /* office still boots even if sync fails once */
        }
        if (!alive) return;
        setUrl(`${base}/studio?arrab=${Date.now()}`);
      } catch (err: unknown) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
        setUrl(null);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [rosterKey]);

  return (
    <section className="ao-host relative flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3">
        <div className="pointer-events-auto flex items-center gap-2">
          {onBack ? (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/95 px-2.5 py-1.5 text-[11px] text-[var(--color-foreground)] shadow-sm backdrop-blur hover:bg-[var(--overlay-1)]"
              onClick={onBack}
            >
              <ArrowLeft className="size-3.5" strokeWidth={1.9} />
              {t("back")}
            </button>
          ) : null}
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/95 px-2.5 py-1.5 shadow-sm backdrop-blur">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-foreground)]">
              {t("hqLiveMapTitle")}
            </p>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]",
                url ? "bg-emerald-500/15 text-emerald-700" : "bg-[var(--overlay-1)] text-[var(--color-muted)]",
              )}
            >
              {url ? "LIVE" : busy ? "…" : "OFF"}
            </span>
          </div>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-transparent">
        {busy ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-[var(--color-foreground)]">
            <Loader2 className="size-6 animate-spin opacity-70" />
            <p className="text-sm">Starting Agents Office...</p>
          </div>
        ) : null}

        {error ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-6 text-center text-[var(--color-foreground)]">
            <TriangleAlert className="size-6 text-amber-500" />
            <p className="max-w-md text-sm leading-relaxed">{error}</p>
            <button
              type="button"
              className="rounded-full bg-[var(--color-primary)] px-4 py-2 text-[12px] text-[var(--color-on-primary)]"
              onClick={() => window.location.reload()}
            >
              {t("refresh")}
            </button>
          </div>
        ) : null}

        {url ? (
          <iframe
            ref={iframeRef}
            title="Agents Office"
            src={url}
            className="absolute inset-0 h-full w-full border-0 bg-transparent"
            allow="clipboard-read; clipboard-write"
          />
        ) : null}
      </div>
    </section>
  );
}

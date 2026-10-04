import { useEffect, useState } from "react";
import type { ProfessionalWorkspaceView } from "@arrab/shared";
import { arrabApi } from "@/core/api/api";

/**
 * Quiet chips above the composer — ideas / watches / goals / finance.
 * No hub pills.
 */
export function MuseQuietRail({ enabled, arabic }: { enabled: boolean; arabic: boolean }) {
  const [workspace, setWorkspace] = useState<ProfessionalWorkspaceView | null>(null);

  useEffect(() => {
    if (!enabled) {
      setWorkspace(null);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const next = await arrabApi.professionalWorkspace();
        if (!cancelled) setWorkspace(next);
      } catch {
        if (!cancelled) setWorkspace(null);
      }
    }
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  if (!enabled || !workspace) return null;

  const ideas = workspace.ideas.filter((item) => item.status === "open").slice(0, 3);
  const watches = workspace.watches.filter((item) => !item.paused).slice(0, 3);
  const goals = workspace.goals.filter((item) => item.status === "open").slice(0, 2);
  const finance = workspace.finance.slice(-1)[0] ?? null;

  if (!ideas.length && !watches.length && !goals.length && !finance) return null;

  async function refresh() {
    try {
      setWorkspace(await arrabApi.professionalWorkspace());
    } catch {
      /* keep last good view */
    }
  }

  return (
    <div className="muse-quiet-rail" aria-label={arabic ? "نشاط ميوز" : "Muse activity"}>
      {ideas.map((idea) => (
        <div key={idea.id} className="muse-quiet-chip">
          <span>{idea.title}</span>
          <button
            type="button"
            onClick={() =>
              void arrabApi
                .upsertMuseIdea({ id: idea.id, title: idea.title, status: "accepted" })
                .then(refresh)
            }
          >
            {arabic ? "اقبل" : "Accept"}
          </button>
          <button
            type="button"
            onClick={() =>
              void arrabApi
                .upsertMuseIdea({ id: idea.id, title: idea.title, status: "dismissed" })
                .then(refresh)
            }
          >
            {arabic ? "تجاهل" : "Dismiss"}
          </button>
        </div>
      ))}
      {watches.map((watch) => (
        <div key={watch.id} className="muse-quiet-chip is-watch">
          <span>
            {arabic ? "مراقبة" : "Watch"} · {watch.label}
          </span>
        </div>
      ))}
      {goals.map((goal) => (
        <div key={goal.id} className="muse-quiet-chip is-goal">
          <span>
            {arabic ? "هدف" : "Goal"} · {goal.title}
            {goal.milestones.length
              ? ` · ${goal.milestones.filter((m) => m.done).length}/${goal.milestones.length}`
              : ""}
          </span>
        </div>
      ))}
      {finance ? (
        <div className="muse-quiet-chip is-finance">
          <span>
            {finance.title}
            {finance.categoryTotals[0]
              ? ` · ${finance.categoryTotals[0].category} ${finance.categoryTotals[0].amount.toFixed(0)}`
              : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}

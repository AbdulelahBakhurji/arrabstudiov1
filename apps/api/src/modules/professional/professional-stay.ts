import { createHash } from "node:crypto";
import type { ProfessionalService } from "./professional-service.js";

const WATCH_TIMEOUT_MS = 8_000;
const STAY_INTERVAL_MS = 60_000;

async function snapshotUrl(url: string): Promise<{ observation: string; priceUsd: number | null }> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(WATCH_TIMEOUT_MS),
    headers: { "user-agent": "ArrabStudioStay/1.0", accept: "text/html,text/plain,*/*" },
    redirect: "follow",
  });
  const text = (await response.text()).slice(0, 200_000);
  const observation = createHash("sha256").update(text).digest("hex").slice(0, 40);
  const priceMatch = text.match(/\$\s?([0-9]+(?:\.[0-9]{1,2})?)/);
  const priceUsd = priceMatch ? Number(priceMatch[1]) : null;
  return {
    observation,
    priceUsd: priceUsd != null && Number.isFinite(priceUsd) ? priceUsd : null,
  };
}

/**
 * Professional Stay worker — runs while Stay is on.
 * Keeps companions on duty without the desktop UI having to poll.
 */
export function startProfessionalStayWorker(input: {
  professional: ProfessionalService;
  deskSweep: () => Promise<void>;
  log?: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };
}): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const view = await input.professional.getForWorker();
      if (!view.stayEnabled) return;
      try {
        await input.deskSweep();
      } catch (error) {
        input.log?.warn({ err: error }, "professional stay desk sweep failed");
      }
      for (const watch of view.watches.filter((item) => !item.paused).slice(0, 20)) {
        try {
          const snap = await snapshotUrl(watch.url);
          await input.professional.observeWatch({
            id: watch.id,
            observation: snap.observation,
            priceUsd: watch.kind === "price" ? snap.priceUsd : null,
          });
        } catch (error) {
          input.log?.warn({ err: error, watchId: watch.id }, "professional stay watch failed");
        }
      }
      await input.professional.markStaySwept();
    } catch (error) {
      input.log?.warn({ err: error }, "professional stay sweep failed");
    } finally {
      running = false;
    }
  };

  void tick();
  const id = setInterval(() => void tick(), STAY_INTERVAL_MS);
  return () => clearInterval(id);
}

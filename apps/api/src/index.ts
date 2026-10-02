import { buildApp, createApiContext } from "./app.js";
import { loadApiEnv, loadDotEnv } from "./platform/config/env.js";

async function main(): Promise<void> {
  loadDotEnv();
  const env = loadApiEnv();
  const context = await createApiContext(env);
  const app = await buildApp(context);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    // A stuck connection or database must not keep the process alive past the orchestrator's kill timeout.
    const forceExit = setTimeout(() => process.exit(1), 15_000);
    forceExit.unref();
    try {
      await app.close();
      await context.flushPersistence?.();
      await context.postgres?.close();
      process.exit(0);
    } catch (error) {
      console.error("shutdown failed", error);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  // Last-resort logging: an unhandled rejection in one request path must be visible, not silent.
  process.on("unhandledRejection", (reason) => {
    app.log.error({ err: reason }, "unhandled promise rejection");
  });

  await app.listen({ host: env.host, port: env.port });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

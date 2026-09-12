import { buildApp, createApiContext } from "./app.js";
import { loadApiEnv, loadDotEnv } from "./config/env.js";

async function main(): Promise<void> {
  loadDotEnv();
  const env = loadApiEnv();
  const context = await createApiContext(env);
  const app = await buildApp(context);

  const shutdown = async () => {
    await app.close();
    await context.postgres?.close();
  };

  process.on("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });

  await app.listen({ host: env.host, port: env.port });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

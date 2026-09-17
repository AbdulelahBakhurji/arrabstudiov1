import { buildApp, createApiContext } from "../src/app.ts";
import { loadApiEnv, loadDotEnv } from "../src/config/env.ts";

async function main() {
  process.env.ARRAB_API_HOST = "127.0.0.1";
  process.env.ARRAB_API_PORT = "8799";
  process.env.ARRAB_CORS_ORIGINS = "*";
  delete process.env.DATABASE_URL;
  loadDotEnv();
  const env = loadApiEnv();
  const ctx = await createApiContext(env);
  const app = await buildApp(ctx);
  const snap = await app.inject({ method: "GET", url: "/v1/org/workforce" });
  console.log("workforce", snap.statusCode, {
    seatsUsed: snap.json().seatsUsed,
    seatLimit: snap.json().seatLimit,
    depts: snap.json().departments?.length,
  });
  const dept = await app.inject({
    method: "POST",
    url: "/v1/org/departments",
    payload: { name: "Engineering", description: "HQ eng" },
  });
  console.log("create dept", dept.statusCode, dept.json()?.id ?? dept.body);
  const emp = await app.inject({
    method: "POST",
    url: "/v1/org/employees",
    payload: {
      email: "alex@arrab.test",
      password: "TempPassw0rd!!",
      displayName: "Alex Admin",
      role: "admin",
      departmentId: dept.json().id,
    },
  });
  console.log("create emp", emp.statusCode, emp.json()?.email ?? emp.body);
  const snap2 = await app.inject({ method: "GET", url: "/v1/org/workforce" });
  const body = snap2.json();
  console.log("workforce2", snap2.statusCode, {
    depts: body.departments?.length,
    employees: body.employees?.length,
    seatsUsed: body.seatsUsed,
    seatLimit: body.seatLimit,
  });
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

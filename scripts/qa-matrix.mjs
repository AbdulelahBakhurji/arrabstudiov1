#!/usr/bin/env node
/**
 * Prints the plan × entitlement matrix from the real catalog (packages/shared), so the QA matrix
 * in docs/QA.md is generated, never hand-edited. Run: node scripts/qa-matrix.mjs > docs/QA-MATRIX.md
 */
import {
  SUBSCRIPTION_PLANS,
  entitlementsForPlan,
  ALL_PLAN_IDS,
} from "../packages/shared/dist/index.js";

const order = [
  "free",
  "solo",
  "pro",
  "studio",
  "family_free",
  "family",
  "family_plus",
  "team",
  "business",
  "enterprise",
  "unlimited",
];
const ids = order.filter((id) => ALL_PLAN_IDS.includes(id));
const sar = (halalas) => (halalas === 0 ? "Free" : `${halalas / 100} SAR/mo`);
const tokens = (n) => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1000}k`);
const rows = [
  ["Audience", (e) => e.audience],
  ["Price", (e, p) => sar(p.monthlyPriceHalalas)],
  ["Monthly tokens", (e) => tokens(e.monthlyTokens)],
  ["Seats included", (e) => (e.seats ? String(e.seats) : "—")],
  ["Org workforce (employee seats, departments)", (e) => (e.orgWorkforce ? "yes" : "no")],
  ["Family household (members, parental controls)", (e) => (e.familyHousehold ? "yes" : "no")],
  ["Live Map", (e) => (e.liveMap ? "yes*" : "no")],
  ["AI employees cap", (e) => (e.maxAgents === null ? "none" : String(e.maxAgents))],
];
const head = `| Entitlement | ${ids.map((id) => SUBSCRIPTION_PLANS[id].name + (id === "unlimited" ? " (legacy id `unlimited`)" : "")).join(" | ")} |`;
const sep = `|---|${ids.map(() => "---").join("|")}|`;
console.log("# Plan × entitlement matrix (generated)\n");
console.log(head);
console.log(sep);
for (const [label, f] of rows)
  console.log(
    `| ${label} | ${ids.map((id) => f(entitlementsForPlan(id), SUBSCRIPTION_PLANS[id])).join(" | ")} |`,
  );
console.log(
  "\n\\* Live Map is a UI feature and is currently hidden in shipped builds (see QA report).",
);

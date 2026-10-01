/**
 * Visual + structural language ported from agents-office (pods, pastel floors,
 * chip colours, metric labels). Used only inside the Workforce live map —
 * does not change the main app chrome.
 */

export type OfficeDeptKey =
  | "emails"
  | "sales"
  | "marketing"
  | "ops"
  | "fin"
  | "delivery"
  | "general";

export type OfficeDeptTheme = {
  key: OfficeDeptKey;
  name: string;
  chip: string;
  ink: string;
  floor: string;
  metric: string;
};

/** Agents-office department palette (Nominal tokens). */
export const OFFICE_DEPTS: Record<OfficeDeptKey, OfficeDeptTheme> = {
  emails: {
    key: "emails",
    name: "EMAILS",
    chip: "#5ADEB7",
    ink: "#1E9070",
    floor: "#E9F6EF",
    metric: "EMAILS SENT",
  },
  sales: {
    key: "sales",
    name: "SALES",
    chip: "#EADC8F",
    ink: "#A08A1E",
    floor: "#F6F1DA",
    metric: "LEADS TOUCHED",
  },
  marketing: {
    key: "marketing",
    name: "MARKETING",
    chip: "#E69393",
    ink: "#C46060",
    floor: "#FAE9E7",
    metric: "SHIPPED WORK",
  },
  ops: {
    key: "ops",
    name: "OPERATIONS",
    chip: "#BFA2E3",
    ink: "#7449A9",
    floor: "#F2ECFA",
    metric: "PROPOSALS",
  },
  fin: {
    key: "fin",
    name: "FINANCE",
    chip: "#98A5EF",
    ink: "#5B66CE",
    floor: "#EAEDFA",
    metric: "INVOICES",
  },
  delivery: {
    key: "delivery",
    name: "DELIVERY",
    chip: "#8FD3F4",
    ink: "#2E86AB",
    floor: "#E6F4FB",
    metric: "REPORTS",
  },
  general: {
    key: "general",
    name: "TEAM",
    chip: "#D1DECD",
    ink: "#4C7A57",
    floor: "#F3EFE6",
    metric: "OPEN WORK",
  },
};

const NAME_MATCHERS: Array<{ key: OfficeDeptKey; needles: string[] }> = [
  { key: "emails", needles: ["email", "inbox", "mail", "support", "helpdesk"] },
  { key: "sales", needles: ["sales", "lead", "outbound", "inbound", "crm", "deal"] },
  {
    key: "marketing",
    needles: ["market", "content", "ads", "social", "brand", "newsletter", "creative"],
  },
  { key: "ops", needles: ["ops", "operation", "legal", "compliance", "admin"] },
  { key: "fin", needles: ["finance", "account", "invoice", "pay", "billing", "ledger"] },
  {
    key: "delivery",
    needles: ["deliver", "project", "qa", "client", "onboard", "report", "desk"],
  },
];

export function resolveOfficeDept(name: string, index = 0): OfficeDeptTheme {
  const hay = name.trim().toLowerCase();
  for (const row of NAME_MATCHERS) {
    if (row.needles.some((n) => hay.includes(n))) return OFFICE_DEPTS[row.key];
  }
  const cycle: OfficeDeptKey[] = ["marketing", "sales", "ops", "emails", "fin", "delivery"];
  return OFFICE_DEPTS[cycle[index % cycle.length]!] ?? OFFICE_DEPTS.general;
}

/** Default desk seating grid inspired by agents-office plinth grids. */
export const OFFICE_DESK_GRID = [
  { x: -88, y: -78 },
  { x: 8, y: -92 },
  { x: 104, y: -70 },
  { x: -100, y: 12 },
  { x: 0, y: 8 },
  { x: 100, y: 24 },
  { x: -60, y: 96 },
  { x: 56, y: 104 },
] as const;

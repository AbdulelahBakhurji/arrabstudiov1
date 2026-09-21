import {
  Activity,
  Cable,
  CalendarDays,
  Figma,
  FolderOpen,
  Github,
  Gitlab,
  GitBranch,
  LineChart,
  Mail,
  MessageCircle,
  Notebook,
  Slack,
  Terminal,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

/** Local display metadata for known providers. New API providers still appear via catalog fetch. */
export const KNOWN_CONNECTOR_META: Record<
  string,
  { name: string; nameAr: string; Icon: LucideIcon }
> = {
  gmail: { name: "Gmail", nameAr: "Gmail", Icon: Mail },
  outlook: { name: "Outlook", nameAr: "Outlook", Icon: Mail },
  email: { name: "Email (IMAP)", nameAr: "البريد (IMAP)", Icon: Mail },
  whatsapp: { name: "WhatsApp Business", nameAr: "واتساب للأعمال", Icon: MessageCircle },
  github: { name: "GitHub", nameAr: "GitHub", Icon: Github },
  gitlab: { name: "GitLab", nameAr: "GitLab", Icon: Gitlab },
  bitbucket: { name: "Bitbucket", nameAr: "Bitbucket", Icon: GitBranch },
  linear: { name: "Linear", nameAr: "Linear", Icon: Waypoints },
  slack: { name: "Slack", nameAr: "Slack", Icon: Slack },
  notion: { name: "Notion", nameAr: "Notion", Icon: Notebook },
  ssh: { name: "SSH", nameAr: "SSH", Icon: Terminal },
  finnhub: { name: "Finnhub", nameAr: "Finnhub", Icon: LineChart },
  whoop: { name: "WHOOP", nameAr: "WHOOP", Icon: Activity },
  fitbit: { name: "Fitbit", nameAr: "Fitbit", Icon: Activity },
  google_drive: { name: "Google Drive", nameAr: "Google Drive", Icon: FolderOpen },
  google_calendar: { name: "Google Calendar", nameAr: "Google Calendar", Icon: CalendarDays },
  figma: { name: "Figma", nameAr: "Figma", Icon: Figma },
};

function titleCaseProvider(provider: string): string {
  return provider
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function connectorIcon(provider: string): LucideIcon {
  return KNOWN_CONNECTOR_META[provider]?.Icon ?? Cable;
}

export function connectorLabel(provider: string, arabic = false): string {
  const known = KNOWN_CONNECTOR_META[provider];
  if (known) return arabic ? known.nameAr : known.name;
  return titleCaseProvider(provider);
}

/** Preferred order — Gmail and Outlook always lead the companion picker. */
const CONNECTOR_PIN_ORDER = ["gmail", "outlook", "whatsapp"] as const;

/** Preferred connectors for Arrab Assistant — every known desktop provider. */
export const ARRAB_ASSISTANT_CONNECTORS = [
  "gmail",
  "outlook",
  "whatsapp",
  "email",
  "github",
  "gitlab",
  "bitbucket",
  "linear",
  "slack",
  "notion",
  "ssh",
  "whoop",
  "fitbit",
  "google_drive",
  "google_calendar",
  "figma",
] as const;

function connectorSortRank(provider: string): number {
  const pin = CONNECTOR_PIN_ORDER.indexOf(provider as (typeof CONNECTOR_PIN_ORDER)[number]);
  return pin === -1 ? 100 : pin;
}

/** Merge API catalog + known providers so future API entries always show up. */
export function resolveConnectorProviders(
  apiProviders: Array<{ provider: string }> | null | undefined,
): string[] {
  const fromApi = (apiProviders ?? []).map((item) => item.provider.trim()).filter(Boolean);
  const known = Object.keys(KNOWN_CONNECTOR_META);
  return Array.from(new Set([...fromApi, ...known])).sort((a, b) => {
    const rank = connectorSortRank(a) - connectorSortRank(b);
    if (rank !== 0) return rank;
    return connectorLabel(a).localeCompare(connectorLabel(b));
  });
}

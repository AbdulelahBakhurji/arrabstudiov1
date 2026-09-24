import type { AiGateway, AiMessage, AiToolCall, AiToolDefinition } from "@arrab/ai";
import {
  AiGatewayError,
  BEDROCK_DEFAULT_MODEL,
  BEDROCK_PROVIDER_ID,
  isBedrockModel,
  isOpenRouterModel,
  isXaiGrokModel,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_PROVIDER_ID,
  XAI_DEFAULT_MODEL,
  XAI_PROVIDER_ID,
} from "@arrab/ai";
import { AppError } from "@arrab/core";
import type { Agent, ConversationId } from "@arrab/shared";
import { fetchUrl, scrapePage, searchWeb } from "./web-search.js";

export class AgentRuntimeError extends AppError {
  constructor(code: string, message: string, statusCode = 501) {
    super(code, message, statusCode, true);
    this.name = "AgentRuntimeError";
  }
}

export interface AgentEmailTools {
  listMessages: (args: Record<string, string>) => Promise<string>;
  readMessage: (args: Record<string, string>) => Promise<string>;
  sendMessage: (args: Record<string, string>) => Promise<string>;
  arrangeMessages: (args: Record<string, string>) => Promise<string>;
}

export interface AgentSshTools {
  execCommand: (args: Record<string, string>) => Promise<string>;
  listHome: (args: Record<string, string>) => Promise<string>;
}

export interface AgentFinnhubTools {
  getQuote: (args: Record<string, string>) => Promise<string>;
  getNews: (args: Record<string, string>) => Promise<string>;
}

export interface AgentSkillTools {
  /** Name + description of every skill the model may load (Claude-style catalog). */
  catalog: Array<{ slug: string; name: string; description: string; active?: boolean }>;
  useSkill: (args: Record<string, string>) => string;
  readSkillFile: (args: Record<string, string>) => string;
}

export interface AgentToolContext {
  workspaceSummary?: string | null;
  activeGoal?: string | null;
  teamRoster?: string | null;
  /** When present, Gmail/email tools are offered and executed server-side. */
  email?: AgentEmailTools | null;
  emailAccountLabel?: string | null;
  /** When present, remote SSH tools are offered and executed server-side. */
  ssh?: AgentSshTools | null;
  sshAccountLabel?: string | null;
  /** When present, Finnhub quote/news tools are offered (no desk folder required). */
  finnhub?: AgentFinnhubTools | null;
  finnhubAccountLabel?: string | null;
  /** When true, add Trader market-tool + no-financial-advice system hints. */
  traderMode?: boolean;
  /** When present, use_skill / read_skill_file are offered and run server-side. */
  skills?: AgentSkillTools | null;
}

export interface AgentPendingTool {
  name: string;
  arguments: Record<string, string>;
  /** Provider tool call id when using native function calling. */
  toolCallId?: string | null;
}

export interface AgentRunRequest {
  agent: Agent;
  conversationId: ConversationId | null;
  input: string;
  history?: readonly AiMessage[];
  model?: string;
  providerId?: string;
  /** Extra system context (e.g. linked GitHub repo metadata). */
  systemExtra?: string | null;
  /** Cap on completion length — keep low to save spend. */
  maxOutputTokens?: number;
  temperature?: number;
  /** Safe read-only tool inputs for Phase 12 tool loop. */
  tools?: AgentToolContext | null;
}

export interface AgentRunResult {
  status: "completed" | "failed" | "needs_approval";
  output: string | null;
  error: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  providerId: string | null;
  model: string | null;
  toolsUsed?: string[];
  pendingTool?: AgentPendingTool | null;
}

export type AgentStreamEvent =
  | { type: "token"; text: string }
  | { type: "tool_start"; name: string; detail?: string }
  | { type: "tool"; name: string; result: string }
  | { type: "approval_needed"; tool: AgentPendingTool }
  | { type: "done"; result: AgentRunResult };

export interface AgentRuntime {
  run(request: AgentRunRequest, gateway: AiGateway): Promise<AgentRunResult>;
  runStream?(
    request: AgentRunRequest,
    gateway: AiGateway,
  ): AsyncIterable<AgentStreamEvent>;
}

export class UnconfiguredAgentRuntime implements AgentRuntime {
  async run(_request: AgentRunRequest, _gateway: AiGateway): Promise<AgentRunResult> {
    throw new AgentRuntimeError(
      "RUNTIME_UNCONFIGURED",
      "Code execution is not enabled in this phase",
    );
  }
}

const NATIVE_TOOLS: AiToolDefinition[] = [
  {
    name: "summarize_workspace",
    description: "Summarize the attached local folder or GitHub workspace context.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "recall_goal",
    description: "Recall the operator's active goal for this session.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_team",
    description: "List the team roster when facilitating a team conversation.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_files",
    description: "List files and directories in the open local folder (optional relative subdirectory).",
    parameters: {
      type: "object",
      properties: {
        relative: {
          type: "string",
          description: "Relative directory path from the folder root (default: .)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_code",
    description:
      "Search the open local folder for a text/regex pattern (Cursor-style codebase search). Prefer this before guessing file paths.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text or regex pattern to find",
        },
        path: {
          type: "string",
          description: "Optional relative subdirectory to scope the search",
        },
        glob: {
          type: "string",
          description: "Optional file glob filter, e.g. *.ts or *.tsx",
        },
        case_sensitive: {
          type: "string",
          description: "Set to 'true' for case-sensitive search (default false)",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description: "Read a text file from the open local folder. Use before editing.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path from the folder root",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description:
      "Write/create a full text file in the open local folder. Prefer apply_patch for small edits. Requires approval unless allow-everything is on.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path" },
        content: { type: "string", description: "Full new file contents" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "apply_patch",
    description:
      "Replace an exact old_string with new_string in a file. old_string must match exactly once. Requires approval unless allow-everything is on.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path" },
        old_string: { type: "string", description: "Exact text to find (unique)" },
        new_string: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old_string", "new_string"],
      additionalProperties: false,
    },
  },
  {
    name: "run_terminal",
    description:
      "Run a shell command in the operator's open local folder. Prefer commands that exit. After edits, run typecheck/tests to verify. Requires approval unless allow-everything is on.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to run in the workspace folder",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_file",
    description:
      "Delete a file or directory under the open local folder. Prefer careful use; checkpoints may restore prior file text. Requires approval unless allow-everything is on.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to delete" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "rename_file",
    description:
      "Rename or move a file/directory inside the open local folder. Requires approval unless allow-everything is on.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Current relative path" },
        to: { type: "string", description: "New relative path" },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "create_dir",
    description: "Create a directory (and parents) inside the open local folder.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative directory path" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "git_status",
    description: "Show git status and a short diffstat for the open folder.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "git_diff",
    description: "Show git diff for the open folder (optional path).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional relative path to scope the diff" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "open_path",
    description:
      "Open a file or folder in the operator's OS (Finder / Explorer / default app).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path (empty = folder root)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "preview_html",
    description:
      "Write an HTML page (optional) into the open folder and open it in the default browser for a live preview. Use for dashboards, docs, landing pages, reports.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative .html path (default: arrab-preview.html)",
        },
        content: {
          type: "string",
          description: "Full HTML document to write before opening. Omit to open an existing file.",
        },
        html: {
          type: "string",
          description: "Alias for content",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "generate_pdf",
    description:
      "Generate a PDF in the open folder from HTML (or markdown-ish text wrapped as HTML), then open it. Prefer for reports, invoices, proposals, one-pagers.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative output .pdf path (default: arrab-report.pdf)",
        },
        content: {
          type: "string",
          description: "HTML or plain text body to convert into a PDF",
        },
        html: {
          type: "string",
          description: "Alias for content (HTML preferred)",
        },
        title: {
          type: "string",
          description: "Document title used in the HTML head",
        },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "export_csv",
    description:
      "Write a CSV spreadsheet file into the open folder (for tables, exports, data dumps).",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative .csv path (default: arrab-export.csv)",
        },
        content: {
          type: "string",
          description: "CSV text including a header row",
        },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "generate_docx",
    description:
      "Create a Microsoft Word (.docx) document in the open folder from title + body text. Prefer for letters, briefs, homework write-ups, and editable reports.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative .docx path (default: arrab-document.docx)",
        },
        title: {
          type: "string",
          description: "Document title (heading)",
        },
        content: {
          type: "string",
          description: "Body text. Use blank lines between paragraphs.",
        },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "generate_presentation",
    description:
      "Create a slide deck (HTML presentation) in the open folder and open it. Separate slides with a line containing only --- . First line of each slide is the title.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative .html path (default: arrab-presentation.html)",
        },
        title: {
          type: "string",
          description: "Deck title shown in the browser tab",
        },
        content: {
          type: "string",
          description: "Slides text. Use --- between slides. First line = slide title.",
        },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "generate_image",
    description:
      "Create a professional image card (SVG) in the open folder from a prompt/title/content. Use for covers, posters, social cards, study visuals.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative .svg path (default: arrab-image.svg)",
        },
        prompt: {
          type: "string",
          description: "What the image should convey",
        },
        title: {
          type: "string",
          description: "Large headline on the image",
        },
        content: {
          type: "string",
          description: "Optional supporting lines",
        },
        width: { type: "string", description: "Optional width in px" },
        height: { type: "string", description: "Optional height in px" },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "read_document",
    description:
      "Read/extract text from a document in the open folder: PDF, Word (.docx), text/markdown/csv, or inspect an image. Prefer this over guessing file contents.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to the document or image",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "web_search",
    description:
      "Search the live web for up-to-date facts, docs, errors, or news (Grok-style realtime lookup). Use when the answer may have changed or is outside the repo.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "fetch_url",
    description:
      "Fetch a public URL and return readable text/HTML (docs, raw files, API JSON). Use after web_search when you need the page body.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "https URL to fetch",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "scrape_page",
    description:
      "Scrape a public web page into structured content: title, description, headings, main text, and outbound links. Prefer over fetch_url for research, competitive pages, docs, and articles.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "https URL to scrape",
        },
        max_chars: {
          type: "string",
          description: "Optional max main-text characters (default 14000)",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_action",
    description:
      "Propose a concrete high-impact action that requires operator approval before proceeding (e.g. commit plan, risky change, external send).",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short action title for the approval card",
        },
        detail: {
          type: "string",
          description: "What will be done if the operator approves",
        },
      },
      required: ["title", "detail"],
      additionalProperties: false,
    },
  },
];

const EMAIL_NATIVE_TOOLS: AiToolDefinition[] = [
  {
    name: "list_email",
    description:
      "List recent messages from the connected Gmail/Outlook/email inbox. Use for triage, unread checks, and finding threads to arrange. Optional mailbox/label (default INBOX) and limit.",
    parameters: {
      type: "object",
      properties: {
        mailbox: {
          type: "string",
          description: "Mailbox or Gmail label id (default INBOX)",
        },
        limit: {
          type: "string",
          description: "Max messages to return (1-30)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "read_email",
    description:
      "Read a full email by id. Use before drafting a reply or arranging that message.",
    parameters: {
      type: "object",
      properties: {
        message_id: {
          type: "string",
          description: "Message id from list_email",
        },
        mailbox: {
          type: "string",
          description: "Mailbox (IMAP only; ignored for Gmail OAuth)",
        },
      },
      required: ["message_id"],
      additionalProperties: false,
    },
  },
  {
    name: "send_email",
    description:
      "Send exactly one email from the connected account. Requires operator Ask-first approval. Never call twice for the same send.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Subject line" },
        text: { type: "string", description: "Plain-text body" },
        cc: { type: "string", description: "Optional CC addresses" },
      },
      required: ["to", "subject", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "arrange_email",
    description:
      "Arrange inbox mail in any useful way: archive, trash, untrash, mark_read, mark_unread, star, unstar, label, or move. Use after list/read. Mutating — requires Ask-first approval. Call once per batch of ids.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description:
            "archive | trash | untrash | mark_read | mark_unread | star | unstar | label | move",
        },
        message_ids: {
          type: "string",
          description: "Comma-separated message ids, or JSON array string",
        },
        mailbox: { type: "string", description: "Source mailbox/label (for move)" },
        target_mailbox: { type: "string", description: "Destination label for move" },
        add_label_ids: { type: "string", description: "Comma-separated labels to add (label action)" },
        remove_label_ids: {
          type: "string",
          description: "Comma-separated labels to remove (label action)",
        },
      },
      required: ["action", "message_ids"],
      additionalProperties: false,
    },
  },
];

const EMAIL_TOOL_NAMES = new Set(EMAIL_NATIVE_TOOLS.map((tool) => tool.name));
const EMAIL_APPROVAL_TOOLS = new Set(["send_email", "arrange_email"]);

const SSH_NATIVE_TOOLS: AiToolDefinition[] = [
  {
    name: "ssh_exec",
    description:
      "Run a command on the operator's connected SSH host. Prefer short, non-interactive commands.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to run remotely (e.g. uname -a, ls -la)",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "ssh_list_home",
    description: "List files and directories in the SSH user's home directory.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional filter substring for names",
        },
      },
      additionalProperties: false,
    },
  },
];

const SSH_TOOL_NAMES = new Set(SSH_NATIVE_TOOLS.map((tool) => tool.name));

const FINNHUB_NATIVE_TOOLS: AiToolDefinition[] = [
  {
    name: "get_quote",
    description:
      "Fetch a live stock/ETF quote from Finnhub (price, change %, day range). Use before giving market perspective. Prices may be delayed.",
    parameters: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "Ticker symbol (e.g. AAPL, MSFT, TSLA)",
        },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
  },
  {
    name: "get_news",
    description:
      "Fetch recent company news headlines from Finnhub for a symbol. Use for catalysts before opinion.",
    parameters: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "Ticker symbol (e.g. AAPL)",
        },
        days: {
          type: "string",
          description: "Lookback window in days (1-30, default 7)",
        },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
  },
];

const FINNHUB_TOOL_NAMES = new Set(FINNHUB_NATIVE_TOOLS.map((tool) => tool.name));

const SKILL_NATIVE_TOOLS: AiToolDefinition[] = [
  {
    name: "use_skill",
    description:
      "Load an installed skill's full instructions (SKILL.md) and its file list. Call this before answering whenever the request matches a skill's description, then follow the instructions exactly.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name from the skills list (e.g. pdf)" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "read_skill_file",
    description:
      "Read a file bundled with a skill (reference docs, templates, or scripts) — e.g. reference.md or scripts/fill_form.py.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name" },
        path: { type: "string", description: "File path inside the skill folder" },
      },
      required: ["name", "path"],
      additionalProperties: false,
    },
  },
];

const SKILL_TOOL_NAMES = new Set(SKILL_NATIVE_TOOLS.map((tool) => tool.name));

function skillCatalogHint(skills: AgentSkillTools): string | null {
  const entries = skills.catalog.slice(0, 40);
  if (entries.length === 0) return null;
  return [
    "Skills (Claude-compatible): the operator installed the skills below.",
    "When a request matches a skill's description, call use_skill with its name BEFORE answering, then follow the returned instructions and output format exactly.",
    "Open files a skill mentions (reference docs, templates, scripts) with read_skill_file. Skills marked [loaded] are already in your instructions — do not reload them.",
    "If a skill needs to run a bundled script and run_terminal is available, run it from the installed path the skill reports; otherwise explain the steps or do the work directly.",
    ...entries.map(
      (entry) =>
        `- ${entry.slug}${entry.active ? " [loaded]" : ""}: ${entry.description.replace(/\s+/g, " ").slice(0, 300) || entry.name}`,
    ),
    'Text protocol: CALL_TOOL use_skill {"name":"pdf"} · CALL_TOOL read_skill_file {"name":"pdf","path":"reference.md"}',
  ].join("\n");
}

/** Plain chat — keep this short so OpenRouter first-token latency stays low. */
const CHAT_HINT = [
  "Answer clearly and helpfully. Prefer short, direct replies unless standing instructions ask for more depth or a different tone.",
  "Language: match the operator's latest message — English in → English out; Arabic in → Arabic out.",
  "Live web is available via web_search, scrape_page, and fetch_url when facts may be outside your knowledge or need a current check.",
  "Deliverables (generate_pdf, generate_docx, generate_presentation, generate_image, preview_html, export_csv, read_document) are available even without a project folder.",
  "Do not invent tool results or claim access to local files, shell, email, or SSH unless those tools are offered in this turn.",
].join("\n");

const TOOL_HINT_WEB = [
  "Live web tools are always available: web_search, scrape_page, and fetch_url.",
  "Use web_search for current facts, docs, errors, news, and research.",
  "Use scrape_page for structured page content (title, headings, links, body).",
  "Use fetch_url for raw/JSON/plain bodies when scrape is unnecessary.",
  "Deliverables always available: preview_html, generate_pdf, generate_docx, generate_presentation, generate_image, export_csv, read_document.",
  'Example: CALL_TOOL web_search {"query":"..."} then CALL_TOOL scrape_page {"url":"https://..."}',
  'Example: CALL_TOOL generate_pdf {"path":"report.pdf","title":"Report","content":"<h1>Hello</h1>"}',
  'Example: CALL_TOOL generate_docx {"path":"brief.docx","title":"Brief","content":"Paragraph one.\\n\\nParagraph two."}',
  'Example: CALL_TOOL generate_presentation {"title":"Plan","content":"Goals\\nShip v1\\n---\\nNext\\nHire designer"}',
  'Example: CALL_TOOL generate_image {"prompt":"Calm study cover","title":"Focus"}',
  'Example: CALL_TOOL read_document {"path":"notes.docx"}',
].join("\n");

const TOOL_HINT = [
  "Tools (optional). Reply with ONLY one of:",
  "CALL_TOOL summarize_workspace",
  "CALL_TOOL recall_goal",
  "CALL_TOOL list_team",
  'CALL_TOOL list_files {"relative":"src"}',
  'CALL_TOOL search_code {"query":"TODO","glob":"*.ts"}',
  'CALL_TOOL read_file {"path":"package.json"}',
  'CALL_TOOL apply_patch {"path":"src/a.ts","old_string":"...","new_string":"..."}',
  'CALL_TOOL write_file {"path":"src/a.ts","content":"..."}',
  'CALL_TOOL delete_file {"path":"tmp.txt"}',
  'CALL_TOOL rename_file {"from":"a.ts","to":"b.ts"}',
  'CALL_TOOL create_dir {"path":"src/new"}',
  "CALL_TOOL git_status",
  'CALL_TOOL git_diff {"path":"src"}',
  'CALL_TOOL open_path {"path":"."}',
  'CALL_TOOL run_terminal {"command":"npm test"}',
  'CALL_TOOL web_search {"query":"React 19 useEffectEvent"}',
  'CALL_TOOL scrape_page {"url":"https://example.com/docs"}',
  'CALL_TOOL fetch_url {"url":"https://example.com/api.json"}',
  'CALL_TOOL preview_html {"path":"preview.html","content":"<!doctype html><html>..."}',
  'CALL_TOOL generate_pdf {"path":"report.pdf","title":"Report","content":"<h1>Hello</h1>"}',
  'CALL_TOOL generate_docx {"path":"brief.docx","title":"Brief","content":"Hello"}',
  'CALL_TOOL generate_presentation {"title":"Plan","content":"One\\n---\\nTwo"}',
  'CALL_TOOL generate_image {"prompt":"Calm cover","title":"Focus"}',
  'CALL_TOOL read_document {"path":"notes.pdf"}',
  'CALL_TOOL export_csv {"path":"data.csv","content":"name,value\\na,1"}',
  'CALL_TOOL propose_action {"title":"...","detail":"..."}',
  "Coding workflow: search_code → read_file → edit → verify with run_terminal. Deliverables: pdf/docx/presentation/image/html/csv + read_document. Be precise; do not invent file contents.",
  "Do not invent tool output — wait for TOOL_RESULT.",
].join("\n");

const TOOL_HINT_NATIVE = [
  "You may call tools for workspace facts, codebase search, files, patches, local shell, live web, HTML preview, PDF, Word, presentations, images, CSV, and document reading.",
  "Coding workflow (mandatory when a folder is attached):",
  "1) Ground yourself with search_code / list_files / read_file (and attached open file / git / terminal / @mentions / rules).",
  "2) Make concrete edits with apply_patch (preferred) or write_file.",
  "3) Verify with run_terminal (typecheck, lint, or tests). Fix from real output. Do not claim done until verified or blocked.",
  "4) Use web_search + scrape_page (or fetch_url) for docs, errors, or facts outside the repo.",
  "5) Deliverables: preview_html, generate_pdf, generate_docx, generate_presentation, generate_image, export_csv; read with read_document.",
  "Be precise and reproducible — prefer exact paths, commands, and outcomes over personality.",
  "Never claim you lack shell/file access when a local folder is open.",
  "State clearly what you fetched, changed, or what failed.",
].join("\n");

const TOOL_HINT_EMAIL = [
  "Gmail/Outlook/email tools are available — use them for inbox, triage, archive, trash, labels, stars, moves, drafts, and sending.",
  "Tools: list_email (scan), read_email (open), arrange_email (organize any way), send_email (send once).",
  "Clear steps every time:",
  "1) list_email to see what needs attention",
  "2) read_email when you need the full body before acting",
  "3) arrange_email for archive/trash/read/unread/star/label/move — batch ids in one call",
  "4) send_email only when the operator asked to send — exactly once per message; never retry the same send",
  "send_email and arrange_email pause for Ask-first approval. After TOOL_RESULT, do not call the same send/arrange again.",
  'Text protocol examples: CALL_TOOL list_email {"limit":"10"}',
  'CALL_TOOL arrange_email {"action":"archive","message_ids":"msg_1,msg_2"}',
  'CALL_TOOL send_email {"to":"a@b.com","subject":"Hi","text":"Hello"}',
].join("\n");

const TOOL_HINT_SSH = [
  "SSH tools are available: ssh_exec, ssh_list_home.",
  "Use them for the operator's connected remote host — list home first when exploring, then run short non-interactive commands.",
  "Never request passwords or private keys in chat; credentials are already stored on the Arrab API.",
].join("\n");

const TOOL_HINT_FINNHUB = [
  "Market data tools are available: get_quote, get_news (Finnhub).",
  "Prefer live quote/news before opinion. Cite source and that prices may be delayed.",
  'Example: CALL_TOOL get_quote {"symbol":"AAPL"} then CALL_TOOL get_news {"symbol":"AAPL"}',
].join("\n");

const TOOL_HINT_TRADER = [
  "You are in Trader mode. This is NOT financial advice and NEVER a guarantee to buy or sell.",
  "Use cautious language (bias / watch / invalidation). Ask horizon and risk tolerance when giving perspective.",
  "If quote/news tools are available, call them before opinion. If data is missing, say so — do not invent prices.",
].join("\n");

const CLIENT_EXEC_TOOLS = new Set([
  "run_terminal",
  "list_files",
  "search_code",
  "read_file",
  "write_file",
  "apply_patch",
  "delete_file",
  "rename_file",
  "create_dir",
  "git_status",
  "git_diff",
  "open_path",
  "preview_html",
  "generate_pdf",
  "export_csv",
  "generate_docx",
  "generate_presentation",
  "generate_image",
  "read_document",
]);

const MAX_TOOL_ROUNDS = 12;

function runSafeTool(
  name: string,
  args: Record<string, string>,
  tools: AgentToolContext | null | undefined,
): string {
  switch (name) {
    case "summarize_workspace":
      return tools?.workspaceSummary?.trim() || "No workspace is attached.";
    case "recall_goal":
      return tools?.activeGoal?.trim() || "No active goal is set.";
    case "list_team":
      return tools?.teamRoster?.trim() || "No team roster is available.";
    case "run_terminal":
    case "list_files":
    case "search_code":
    case "read_file":
    case "write_file":
    case "apply_patch":
    case "delete_file":
    case "rename_file":
    case "create_dir":
    case "git_status":
    case "git_diff":
    case "open_path":
    case "preview_html":
    case "generate_pdf":
    case "export_csv":
    case "generate_docx":
    case "generate_presentation":
    case "generate_image":
    case "read_document":
      return (
        args._clientResult?.trim() ||
        "This tool runs on the desktop client after approval/auto-exec. No result was provided."
      );
    case "propose_action": {
      const title = args.title?.trim() || "Proposed action";
      const detail = args.detail?.trim() || "";
      return `Operator approved: ${title}${detail ? `\n${detail}` : ""}`;
    }
    default:
      return `Unknown tool '${name}'. Available: summarize_workspace, recall_goal, list_team, list_files, search_code, read_file, write_file, apply_patch, delete_file, rename_file, create_dir, git_status, git_diff, open_path, preview_html, generate_pdf, generate_docx, generate_presentation, generate_image, read_document, export_csv, run_terminal, web_search, scrape_page, fetch_url, propose_action.`;
  }
}

async function runTool(
  name: string,
  args: Record<string, string>,
  tools: AgentToolContext | null | undefined,
): Promise<string> {
  if (name === "web_search") {
    return searchWeb(args.query || args.q || "");
  }
  if (name === "fetch_url") {
    return fetchUrl(args.url || args.href || "");
  }
  if (name === "scrape_page") {
    const max = Number(args.max_chars || args.maxChars || "");
    return scrapePage(args.url || args.href || "", {
      maxChars: Number.isFinite(max) && max > 0 ? max : undefined,
    });
  }
  if (EMAIL_TOOL_NAMES.has(name)) {
    const email = tools?.email;
    if (!email) {
      return "No email/Gmail connector is linked. Ask the operator to Connect Gmail in Connectors.";
    }
    try {
      if (name === "list_email") return await email.listMessages(args);
      if (name === "read_email") return await email.readMessage(args);
      if (name === "send_email") return await email.sendMessage(args);
      if (name === "arrange_email") return await email.arrangeMessages(args);
    } catch (error: unknown) {
      return `FAILED ${name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (SSH_TOOL_NAMES.has(name)) {
    const ssh = tools?.ssh;
    if (!ssh) {
      return "No SSH connector is linked. Ask the operator to Connect SSH in Connectors.";
    }
    try {
      if (name === "ssh_exec") return await ssh.execCommand(args);
      if (name === "ssh_list_home") return await ssh.listHome(args);
    } catch (error: unknown) {
      return `FAILED ${name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (SKILL_TOOL_NAMES.has(name)) {
    const skills = tools?.skills;
    if (!skills) return "No skills are installed for this conversation.";
    try {
      return name === "use_skill" ? skills.useSkill(args) : skills.readSkillFile(args);
    } catch (error: unknown) {
      return `FAILED ${name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (FINNHUB_TOOL_NAMES.has(name)) {
    const finnhub = tools?.finnhub;
    if (!finnhub) {
      return "Finnhub is not configured. Set FINNHUB_API_KEY on the API or Connect Finnhub in Connectors.";
    }
    try {
      if (name === "get_quote") return await finnhub.getQuote(args);
      if (name === "get_news") return await finnhub.getNews(args);
    } catch (error: unknown) {
      return `FAILED ${name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return runSafeTool(name, args, tools);
}

function requiresApproval(name: string): boolean {
  return (
    name === "propose_action" ||
    CLIENT_EXEC_TOOLS.has(name) ||
    EMAIL_APPROVAL_TOOLS.has(name) ||
    SSH_TOOL_NAMES.has(name)
  );
}

export function isClientExecTool(name: string): boolean {
  return CLIENT_EXEC_TOOLS.has(name);
}

export function isEmailApprovalTool(name: string): boolean {
  return EMAIL_APPROVAL_TOOLS.has(name);
}

function parseArgsObject(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value == null) continue;
      out[key] = typeof value === "string" ? value : JSON.stringify(value);
    }
    return out;
  } catch {
    return { detail: raw.trim() };
  }
}

/** Text CALL_TOOL protocol used when the provider has no native tools. */
function parseTextToolCall(
  content: string,
): { name: string; arguments: Record<string, string> } | null {
  const trimmed = content.trim();
  const match = trimmed.match(/^CALL_TOOL\s+([a-z_]+)(?:\s+([\s\S]+))?$/i);
  if (!match) {
    return null;
  }
  const name = match[1]!.toLowerCase();
  const args = parseArgsObject(match[2]);
  if (name === "propose_action") {
    if (!args.title) args.title = "Proposed action";
    if (!args.detail) args.detail = match[2]?.trim() || "Proceed as discussed.";
  }
  if (name === "run_terminal") {
    if (!args.command && match[2]?.trim()) {
      try {
        const parsed = JSON.parse(match[2].trim()) as { command?: string };
        if (parsed.command) args.command = parsed.command;
        else args.command = match[2].trim();
      } catch {
        args.command = match[2].trim();
      }
    }
  }
  return { name, arguments: args };
}

export class GatewayChatRuntime implements AgentRuntime {
  constructor(private readonly defaultProviderId = "openai") {}

  private pickProvider(request: AgentRunRequest, gateway: AiGateway) {
    const providers = gateway.listProviders();
    if (providers.length === 0) {
      throw new AgentRuntimeError(
        "NO_PROVIDER",
        "No model provider is configured. Set AWS_BEARER_TOKEN_BEDROCK on the Arrab API (Railway Variables).",
        503,
      );
    }

    const requestedModel = request.model ?? null;
    if (
      isOpenRouterModel(requestedModel) ||
      (!requestedModel && this.defaultProviderId === OPENROUTER_PROVIDER_ID)
    ) {
      const openrouter = gateway.getProvider(OPENROUTER_PROVIDER_ID);
      if (!openrouter) {
        throw new AgentRuntimeError(
          "NO_PROVIDER",
          "OpenRouter models require OPENROUTER_API_KEY. Add the key on the Arrab API server, then restart.",
          503,
        );
      }
      return {
        provider: openrouter,
        modelName: requestedModel?.trim() || OPENROUTER_DEFAULT_MODEL,
      };
    }

    if (
      isBedrockModel(requestedModel) ||
      (!requestedModel && this.defaultProviderId === BEDROCK_PROVIDER_ID)
    ) {
      const bedrock = gateway.getProvider(BEDROCK_PROVIDER_ID);
      if (!bedrock) {
        throw new AgentRuntimeError(
          "NO_PROVIDER",
          "Bedrock models require AWS_BEARER_TOKEN_BEDROCK. Add the Bedrock API key on Railway, then redeploy.",
          503,
        );
      }
      return {
        provider: bedrock,
        modelName: requestedModel?.trim() || BEDROCK_DEFAULT_MODEL,
      };
    }

    if (isXaiGrokModel(requestedModel) || (!requestedModel && this.defaultProviderId === XAI_PROVIDER_ID)) {
      const xai = gateway.getProvider(XAI_PROVIDER_ID);
      if (!xai) {
        throw new AgentRuntimeError(
          "NO_PROVIDER",
          "Grok models require XAI_API_KEY. Export XAI_API_KEY from console.x.ai, then restart the Arrab API.",
          503,
        );
      }
      return {
        provider: xai,
        modelName: requestedModel && isXaiGrokModel(requestedModel) ? requestedModel : XAI_DEFAULT_MODEL,
      };
    }

    const providerId = request.providerId ?? this.defaultProviderId;
    const provider = gateway.getProvider(providerId) ?? providers[0];
    if (!provider) {
      throw new AgentRuntimeError("NO_PROVIDER", "No model provider is available", 503);
    }
    const defaultModel =
      provider.id === "anthropic"
        ? "claude-3-5-haiku-latest"
        : provider.id === BEDROCK_PROVIDER_ID
          ? BEDROCK_DEFAULT_MODEL
          : provider.id === OPENROUTER_PROVIDER_ID
            ? OPENROUTER_DEFAULT_MODEL
          : provider.id === XAI_PROVIDER_ID
            ? XAI_DEFAULT_MODEL
            : "gpt-4o-mini";
    return { provider, modelName: request.model ?? defaultModel };
  }

  private buildSystem(
    request: AgentRunRequest,
    options: { hasDesk: boolean; useNativeDeskTools: boolean },
  ): AiMessage {
    const hasEmail = Boolean(request.tools?.email);
    const emailLine = hasEmail
      ? `Connected mail: ${request.tools?.emailAccountLabel?.trim() || "Gmail/email"}.\n${TOOL_HINT_EMAIL}`
      : null;
    const hasSsh = Boolean(request.tools?.ssh);
    const sshLine = hasSsh
      ? `Connected SSH: ${request.tools?.sshAccountLabel?.trim() || "remote host"}.\n${TOOL_HINT_SSH}`
      : null;
    const hasFinnhub = Boolean(request.tools?.finnhub);
    const finnhubLine = hasFinnhub
      ? `Market data: ${request.tools?.finnhubAccountLabel?.trim() || "Finnhub"}.\n${TOOL_HINT_FINNHUB}`
      : null;
    const traderLine = request.tools?.traderMode ? TOOL_HINT_TRADER : null;
    const skillsLine = request.tools?.skills ? skillCatalogHint(request.tools.skills) : null;
    const deskHint = options.hasDesk
      ? options.useNativeDeskTools
        ? TOOL_HINT_NATIVE
        : TOOL_HINT
      : null;
    const webHint = options.hasDesk ? null : TOOL_HINT_WEB;
    const baseSystem = [
      `You are ${request.agent.name}, an AI employee at Arrab Studio.`,
      `Your role is: ${request.agent.role}.`,
      request.agent.specialty ? `Specialty: ${request.agent.specialty}.` : null,
      request.agent.bio ? `Background / who you are:\n${request.agent.bio}` : null,
      request.agent.instructions
        ? `Standing instructions from your operator (follow carefully when anyone writes to you):\n${request.agent.instructions}`
        : null,
      options.hasDesk
        ? "Work like a precise engineering teammate: follow standing instructions, use tools for real context, verify with commands, and never claim system access you do not have."
        : CHAT_HINT,
      deskHint,
      webHint,
      emailLine,
      sshLine,
      finnhubLine,
      traderLine,
      skillsLine,
    ]
      .filter(Boolean)
      .join("\n\n");
    return {
      role: "system",
      content: request.systemExtra?.trim()
        ? `${baseSystem}\n\n${request.systemExtra.trim()}`
        : baseSystem,
    };
  }

  private async *runLoop(
    request: AgentRunRequest,
    gateway: AiGateway,
    streamTokens: boolean,
  ): AsyncGenerator<AgentStreamEvent, void, undefined> {
    const { provider, modelName } = this.pickProvider(request, gateway);
    const workspaceSummary = request.tools?.workspaceSummary ?? "";
    // Keep desk tools whenever a local folder / GitHub desk (or resume after a local tool) is active.
    const hasDesk =
      /(^|\n)mode=(folder|github)\b/.test(workspaceSummary) ||
      /(^|\n)desk=local\b/.test(workspaceSummary) ||
      /Local folder:/i.test(workspaceSummary);
    const hasEmail = Boolean(request.tools?.email);
    const hasSsh = Boolean(request.tools?.ssh);
    const hasFinnhub = Boolean(request.tools?.finnhub);
    const hasSkills = Boolean(request.tools?.skills?.catalog.length);
    const webToolNames = new Set(["web_search", "fetch_url", "scrape_page"]);
    const deliverableToolNames = new Set([
      "preview_html",
      "generate_pdf",
      "export_csv",
      "generate_docx",
      "generate_presentation",
      "generate_image",
      "read_document",
    ]);
    const webTools = NATIVE_TOOLS.filter((tool) => webToolNames.has(tool.name));
    const deliverableTools = NATIVE_TOOLS.filter((tool) => deliverableToolNames.has(tool.name));
    const deskTools = NATIVE_TOOLS.filter(
      (tool) => !webToolNames.has(tool.name) && !deliverableToolNames.has(tool.name),
    );
    const activeTools = [
      ...(hasDesk ? deskTools : []),
      // PDF / HTML / CSV deliverables are always offered; desktop runs them on a desk folder.
      ...deliverableTools,
      ...webTools,
      ...(hasEmail ? EMAIL_NATIVE_TOOLS : []),
      ...(hasSsh ? SSH_NATIVE_TOOLS : []),
      ...(hasFinnhub ? FINNHUB_NATIVE_TOOLS : []),
      ...(hasSkills ? SKILL_NATIVE_TOOLS : []),
    ];
    // Web tools alone are enough to enable native tooling on plain chat.
    const useNativeTools = provider.supportsTools === true && activeTools.length > 0;
    const system = this.buildSystem(request, {
      hasDesk,
      useNativeDeskTools: hasDesk && provider.supportsTools === true,
    });
    let working: AiMessage[] = [
      system,
      ...(request.history ?? []).filter((message) => message.role !== "system"),
      { role: "user", content: request.input },
    ];

    let inputTokens = 0;
    let outputTokens = 0;
    const toolsUsed: string[] = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const completionRequest = {
        model: { providerId: provider.id, model: modelName },
        messages: working,
        maxOutputTokens: request.maxOutputTokens ?? 280,
        temperature: request.temperature ?? 0.4,
        tools: useNativeTools ? activeTools : undefined,
      };
      let completion = null as Awaited<ReturnType<AiGateway["complete"]>> | null;
      let streamedThisRound = false;
      if (streamTokens) {
        for await (const chunk of gateway.streamComplete(completionRequest)) {
          if (chunk.type === "token") {
            streamedThisRound = true;
            yield { type: "token", text: chunk.text };
          } else {
            completion = chunk.completion;
          }
        }
      } else {
        completion = await gateway.complete(completionRequest);
      }
      if (!completion) {
        throw new AgentRuntimeError("CHAT_FAILED", "Provider stream ended without a completion", 502);
      }
      if (completion.usage) {
        inputTokens += completion.usage.inputTokens;
        outputTokens += completion.usage.outputTokens;
      }

      const nativeCalls = completion.toolCalls ?? completion.message.toolCalls;
      let pendingName: string | null = null;
      let pendingArgs: Record<string, string> = {};
      let pendingCallId: string | null = null;

      if (nativeCalls && nativeCalls.length > 0) {
        const call = nativeCalls[0]!;
        pendingName = call.name;
        pendingArgs = parseArgsObject(call.arguments);
        pendingCallId = call.id;
      } else {
        const textCall = parseTextToolCall(completion.message.content);
        if (textCall) {
          pendingName = textCall.name;
          pendingArgs = textCall.arguments;
        }
      }

      if (!pendingName || round === MAX_TOOL_ROUNDS - 1) {
        const output = completion.message.content.trim();
        // Tokens were already streamed live. Only dump the full reply when we
        // used the non-stream complete() path.
        if (streamTokens && output && !streamedThisRound) {
          yield { type: "token", text: output };
        }
        yield {
          type: "done",
          result: {
            status: "completed",
            output,
            error: null,
            usage: { inputTokens, outputTokens },
            providerId: provider.id,
            model: modelName,
            toolsUsed,
          },
        };
        return;
      }

      if (requiresApproval(pendingName)) {
        if (pendingName === "run_terminal") {
          const command = pendingArgs.command?.trim() || "";
          if (!command) {
            const missing = "FAILED run_terminal: requires a non-empty command argument.";
            toolsUsed.push(pendingName);
            yield { type: "tool", name: pendingName, result: missing };
            working = [
              ...working,
              { role: "assistant", content: completion.message.content || "" },
              {
                role: "user",
                content: `TOOL_RESULT ${pendingName}:\n${missing}\n\nContinue helping the operator.`,
              },
            ];
            continue;
          }
          pendingArgs.command = command;
          pendingArgs.title = pendingArgs.title || `Run: ${command.slice(0, 72)}`;
          pendingArgs.detail = pendingArgs.detail || command;
        } else if (pendingName === "read_file") {
          const path = pendingArgs.path?.trim() || "";
          if (!path) {
            const missing = "FAILED read_file: requires path.";
            toolsUsed.push(pendingName);
            yield { type: "tool", name: pendingName, result: missing };
            working = [
              ...working,
              { role: "assistant", content: completion.message.content || "" },
              {
                role: "user",
                content: `TOOL_RESULT ${pendingName}:\n${missing}\n\nContinue helping the operator.`,
              },
            ];
            continue;
          }
          pendingArgs.path = path;
          pendingArgs.title = `Read: ${path}`;
          pendingArgs.detail = path;
        } else if (pendingName === "list_files") {
          const relative = (pendingArgs.relative || pendingArgs.path || ".").trim() || ".";
          pendingArgs.relative = relative;
          pendingArgs.title = `List: ${relative}`;
          pendingArgs.detail = relative;
        } else if (pendingName === "search_code") {
          const query = pendingArgs.query?.trim() || "";
          if (!query) {
            const missing = "FAILED search_code: requires query.";
            toolsUsed.push(pendingName);
            yield { type: "tool", name: pendingName, result: missing };
            working = [
              ...working,
              { role: "assistant", content: completion.message.content || "" },
              {
                role: "user",
                content: `TOOL_RESULT ${pendingName}:\n${missing}\n\nContinue helping the operator.`,
              },
            ];
            continue;
          }
          pendingArgs.query = query;
          pendingArgs.title = `Search: ${query.slice(0, 64)}`;
          pendingArgs.detail = query;
        } else if (pendingName === "write_file") {
          const path = pendingArgs.path?.trim() || "";
          if (!path || pendingArgs.content == null) {
            const missing = "FAILED write_file: requires path and content.";
            toolsUsed.push(pendingName);
            yield { type: "tool", name: pendingName, result: missing };
            working = [
              ...working,
              { role: "assistant", content: completion.message.content || "" },
              {
                role: "user",
                content: `TOOL_RESULT ${pendingName}:\n${missing}\n\nContinue helping the operator.`,
              },
            ];
            continue;
          }
          pendingArgs.path = path;
          pendingArgs.title = `Write: ${path}`;
          pendingArgs.detail = `Write ${path} (${pendingArgs.content.length} chars)`;
        } else if (pendingName === "apply_patch") {
          const path = pendingArgs.path?.trim() || "";
          if (!path || !pendingArgs.old_string) {
            const missing = "FAILED apply_patch: requires path and old_string.";
            toolsUsed.push(pendingName);
            yield { type: "tool", name: pendingName, result: missing };
            working = [
              ...working,
              { role: "assistant", content: completion.message.content || "" },
              {
                role: "user",
                content: `TOOL_RESULT ${pendingName}:\n${missing}\n\nContinue helping the operator.`,
              },
            ];
            continue;
          }
          pendingArgs.path = path;
          pendingArgs.title = `Patch: ${path}`;
          pendingArgs.detail = `Patch ${path}`;
        } else if (pendingName === "delete_file") {
          const path = pendingArgs.path?.trim() || "";
          if (!path) {
            const missing = "FAILED delete_file: requires path.";
            toolsUsed.push(pendingName);
            yield { type: "tool", name: pendingName, result: missing };
            working = [
              ...working,
              { role: "assistant", content: completion.message.content || "" },
              {
                role: "user",
                content: `TOOL_RESULT ${pendingName}:\n${missing}\n\nContinue helping the operator.`,
              },
            ];
            continue;
          }
          pendingArgs.path = path;
          pendingArgs.title = `Delete: ${path}`;
          pendingArgs.detail = path;
        } else if (pendingName === "rename_file") {
          const from = pendingArgs.from?.trim() || pendingArgs.path?.trim() || "";
          const to = pendingArgs.to?.trim() || pendingArgs.new_path?.trim() || "";
          if (!from || !to) {
            const missing = "FAILED rename_file: requires from and to.";
            toolsUsed.push(pendingName);
            yield { type: "tool", name: pendingName, result: missing };
            working = [
              ...working,
              { role: "assistant", content: completion.message.content || "" },
              {
                role: "user",
                content: `TOOL_RESULT ${pendingName}:\n${missing}\n\nContinue helping the operator.`,
              },
            ];
            continue;
          }
          pendingArgs.from = from;
          pendingArgs.to = to;
          pendingArgs.title = `Rename: ${from} → ${to}`;
          pendingArgs.detail = `${from} → ${to}`;
        } else if (pendingName === "create_dir") {
          const path = (pendingArgs.path || pendingArgs.relative || "").trim();
          if (!path) {
            const missing = "FAILED create_dir: requires path.";
            toolsUsed.push(pendingName);
            yield { type: "tool", name: pendingName, result: missing };
            working = [
              ...working,
              { role: "assistant", content: completion.message.content || "" },
              {
                role: "user",
                content: `TOOL_RESULT ${pendingName}:\n${missing}\n\nContinue helping the operator.`,
              },
            ];
            continue;
          }
          pendingArgs.path = path;
          pendingArgs.title = `Mkdir: ${path}`;
          pendingArgs.detail = path;
        } else if (pendingName === "git_status") {
          pendingArgs.title = "Git status";
          pendingArgs.detail = "git status -sb && git diff --stat";
        } else if (pendingName === "git_diff") {
          const path = pendingArgs.path?.trim() || "";
          pendingArgs.title = path ? `Git diff: ${path}` : "Git diff";
          pendingArgs.detail = path || "git diff";
        } else if (pendingName === "open_path") {
          const path = (pendingArgs.path || pendingArgs.relative || ".").trim() || ".";
          pendingArgs.path = path === "." ? "" : path;
          pendingArgs.title = `Open: ${path}`;
          pendingArgs.detail = path;
        } else if (pendingName === "preview_html") {
          const path =
            (pendingArgs.path || "").trim() ||
            (pendingArgs.content || pendingArgs.html ? "arrab-preview.html" : "");
          if (!path && !(pendingArgs.content || pendingArgs.html)) {
            const missing = "FAILED preview_html: requires path or content.";
            toolsUsed.push(pendingName);
            yield { type: "tool", name: pendingName, result: missing };
            working = [
              ...working,
              { role: "assistant", content: completion.message.content || "" },
              {
                role: "user",
                content: `TOOL_RESULT ${pendingName}:\n${missing}\n\nContinue helping the operator.`,
              },
            ];
            continue;
          }
          pendingArgs.path = path || "arrab-preview.html";
          if (pendingArgs.html && !pendingArgs.content) pendingArgs.content = pendingArgs.html;
          pendingArgs.title = `HTML preview: ${pendingArgs.path}`;
          pendingArgs.detail = pendingArgs.path;
        } else if (pendingName === "generate_pdf") {
          const content = pendingArgs.content || pendingArgs.html || "";
          if (!content.trim()) {
            const missing = "FAILED generate_pdf: requires content.";
            toolsUsed.push(pendingName);
            yield { type: "tool", name: pendingName, result: missing };
            working = [
              ...working,
              { role: "assistant", content: completion.message.content || "" },
              {
                role: "user",
                content: `TOOL_RESULT ${pendingName}:\n${missing}\n\nContinue helping the operator.`,
              },
            ];
            continue;
          }
          pendingArgs.path = (pendingArgs.path || "").trim() || "arrab-report.pdf";
          pendingArgs.content = content;
          pendingArgs.title = `PDF: ${pendingArgs.path}`;
          pendingArgs.detail = pendingArgs.path;
        } else if (pendingName === "export_csv") {
          const content = pendingArgs.content || "";
          if (!content.trim()) {
            const missing = "FAILED export_csv: requires content.";
            toolsUsed.push(pendingName);
            yield { type: "tool", name: pendingName, result: missing };
            working = [
              ...working,
              { role: "assistant", content: completion.message.content || "" },
              {
                role: "user",
                content: `TOOL_RESULT ${pendingName}:\n${missing}\n\nContinue helping the operator.`,
              },
            ];
            continue;
          }
          pendingArgs.path = (pendingArgs.path || "").trim() || "arrab-export.csv";
          pendingArgs.content = content;
          pendingArgs.title = `CSV: ${pendingArgs.path}`;
          pendingArgs.detail = pendingArgs.path;
        } else if (pendingName === "generate_docx") {
          const content = pendingArgs.content || pendingArgs.body || "";
          if (!content.trim()) {
            const missing = "FAILED generate_docx: requires content.";
            toolsUsed.push(pendingName);
            yield { type: "tool", name: pendingName, result: missing };
            working = [
              ...working,
              { role: "assistant", content: completion.message.content || "" },
              {
                role: "user",
                content: `TOOL_RESULT ${pendingName}:\n${missing}\n\nContinue helping the operator.`,
              },
            ];
            continue;
          }
          pendingArgs.path = (pendingArgs.path || "").trim() || "arrab-document.docx";
          pendingArgs.content = content;
          pendingArgs.title = `Word: ${pendingArgs.path}`;
          pendingArgs.detail = pendingArgs.path;
        } else if (pendingName === "generate_presentation") {
          const content = pendingArgs.content || pendingArgs.slides || "";
          if (!content.trim()) {
            const missing = "FAILED generate_presentation: requires content.";
            toolsUsed.push(pendingName);
            yield { type: "tool", name: pendingName, result: missing };
            working = [
              ...working,
              { role: "assistant", content: completion.message.content || "" },
              {
                role: "user",
                content: `TOOL_RESULT ${pendingName}:\n${missing}\n\nContinue helping the operator.`,
              },
            ];
            continue;
          }
          pendingArgs.path = (pendingArgs.path || "").trim() || "arrab-presentation.html";
          pendingArgs.content = content;
          pendingArgs.title = `Presentation: ${pendingArgs.path}`;
          pendingArgs.detail = pendingArgs.path;
        } else if (pendingName === "generate_image") {
          const prompt =
            pendingArgs.prompt || pendingArgs.content || pendingArgs.title || "";
          if (!prompt.trim()) {
            const missing = "FAILED generate_image: requires prompt.";
            toolsUsed.push(pendingName);
            yield { type: "tool", name: pendingName, result: missing };
            working = [
              ...working,
              { role: "assistant", content: completion.message.content || "" },
              {
                role: "user",
                content: `TOOL_RESULT ${pendingName}:\n${missing}\n\nContinue helping the operator.`,
              },
            ];
            continue;
          }
          pendingArgs.prompt = prompt;
          pendingArgs.path = (pendingArgs.path || "").trim() || "arrab-image.svg";
          pendingArgs.title = `Image: ${pendingArgs.path}`;
          pendingArgs.detail = prompt.slice(0, 200);
        } else if (pendingName === "read_document") {
          const path = (pendingArgs.path || pendingArgs.relative || "").trim();
          if (!path) {
            const missing = "FAILED read_document: requires path.";
            toolsUsed.push(pendingName);
            yield { type: "tool", name: pendingName, result: missing };
            working = [
              ...working,
              { role: "assistant", content: completion.message.content || "" },
              {
                role: "user",
                content: `TOOL_RESULT ${pendingName}:\n${missing}\n\nContinue helping the operator.`,
              },
            ];
            continue;
          }
          pendingArgs.path = path;
          pendingArgs.title = `Document: ${path}`;
          pendingArgs.detail = path;
        } else if (pendingName === "send_email") {
          const to = pendingArgs.to?.trim() || "";
          const subject = pendingArgs.subject?.trim() || "";
          const text = pendingArgs.text ?? "";
          if (!to.includes("@") || !subject) {
            const missing = "FAILED send_email: requires to and subject.";
            toolsUsed.push(pendingName);
            yield { type: "tool", name: pendingName, result: missing };
            working = [
              ...working,
              { role: "assistant", content: completion.message.content || "" },
              {
                role: "user",
                content: `TOOL_RESULT ${pendingName}:\n${missing}\n\nContinue helping the operator.`,
              },
            ];
            continue;
          }
          pendingArgs.to = to;
          pendingArgs.subject = subject;
          pendingArgs.text = text;
          pendingArgs.title = `Send email: ${subject.slice(0, 64)}`;
          pendingArgs.detail = `To: ${to}${pendingArgs.cc ? `\nCc: ${pendingArgs.cc}` : ""}\nSubject: ${subject}\n\n${text.slice(0, 1200)}`;
        } else if (pendingName === "arrange_email") {
          const action = pendingArgs.action?.trim() || "";
          const messageIds = pendingArgs.message_ids?.trim() || "";
          if (!action || !messageIds) {
            const missing = "FAILED arrange_email: requires action and message_ids.";
            toolsUsed.push(pendingName);
            yield { type: "tool", name: pendingName, result: missing };
            working = [
              ...working,
              { role: "assistant", content: completion.message.content || "" },
              {
                role: "user",
                content: `TOOL_RESULT ${pendingName}:\n${missing}\n\nContinue helping the operator.`,
              },
            ];
            continue;
          }
          pendingArgs.action = action;
          pendingArgs.message_ids = messageIds;
          const idCount = messageIds.startsWith("[")
            ? Math.max(1, messageIds.split(",").length)
            : messageIds.split(",").filter(Boolean).length;
          pendingArgs.title = `Arrange mail: ${action} (${idCount})`;
          pendingArgs.detail = `Action: ${action}\nMessages: ${messageIds.slice(0, 400)}`;
        } else {
          if (!pendingArgs.title) pendingArgs.title = "Proposed action";
          if (!pendingArgs.detail) pendingArgs.detail = "Proceed as discussed.";
        }
        const pendingTool: AgentPendingTool = {
          name: pendingName,
          arguments: pendingArgs,
          toolCallId: pendingCallId,
        };
        yield {
          type: "tool_start",
          name: pendingName,
          detail:
            pendingArgs.detail ||
            pendingArgs.path ||
            pendingArgs.query ||
            pendingArgs.command ||
            pendingArgs.relative ||
            pendingArgs.subject ||
            pendingArgs.action ||
            undefined,
        };
        yield { type: "approval_needed", tool: pendingTool };
        const awaitLabel = CLIENT_EXEC_TOOLS.has(pendingName)
          ? `Local tool awaiting desktop execution: ${pendingArgs.title}`
          : EMAIL_APPROVAL_TOOLS.has(pendingName)
            ? `Email action awaiting approval: ${pendingArgs.title}`
            : `Proposed action awaiting approval: ${pendingArgs.title}`;
        yield {
          type: "done",
          result: {
            status: "needs_approval",
            output: awaitLabel,
            error: null,
            usage: { inputTokens, outputTokens },
            providerId: provider.id,
            model: modelName,
            toolsUsed,
            pendingTool,
          },
        };
        return;
      }

      yield {
        type: "tool_start",
        name: pendingName,
        detail:
          pendingArgs.detail ||
          pendingArgs.path ||
          pendingArgs.query ||
          pendingArgs.command ||
          pendingArgs.relative ||
          undefined,
      };
      const result = await runTool(pendingName, pendingArgs, request.tools);
      toolsUsed.push(pendingName);
      yield { type: "tool", name: pendingName, result };

      if (useNativeTools && pendingCallId) {
        const assistantToolMessage: AiMessage = {
          role: "assistant",
          content: completion.message.content || "",
          toolCalls: nativeCalls as AiToolCall[],
        };
        working = [
          ...working,
          assistantToolMessage,
          {
            role: "tool",
            content: result,
            toolCallId: pendingCallId,
          },
        ];
      } else {
        working = [
          ...working,
          { role: "assistant", content: completion.message.content },
          {
            role: "user",
            content: `TOOL_RESULT ${pendingName}:\n${result}\n\nContinue helping the operator. Do not call the same tool again unless necessary.`,
          },
        ];
      }
    }

    yield {
      type: "done",
      result: {
        status: "failed",
        output: null,
        error: "Tool loop exceeded",
        usage: { inputTokens, outputTokens },
        providerId: provider.id,
        model: modelName,
        toolsUsed,
      },
    };
  }

  async run(request: AgentRunRequest, gateway: AiGateway): Promise<AgentRunResult> {
    try {
      let final: AgentRunResult | null = null;
      for await (const event of this.runLoop(request, gateway, false)) {
        if (event.type === "done") {
          final = event.result;
        }
      }
      if (!final) {
        throw new AgentRuntimeError("CHAT_FAILED", "Agent produced no result", 502);
      }
      return final;
    } catch (error) {
      if (error instanceof AiGatewayError || error instanceof AgentRuntimeError) {
        throw error;
      }
      throw new AgentRuntimeError(
        "CHAT_FAILED",
        error instanceof Error ? error.message : "Chat completion failed",
        502,
      );
    }
  }

  async *runStream(
    request: AgentRunRequest,
    gateway: AiGateway,
  ): AsyncIterable<AgentStreamEvent> {
    try {
      yield* this.runLoop(request, gateway, true);
    } catch (error) {
      if (error instanceof AiGatewayError || error instanceof AgentRuntimeError) {
        throw error;
      }
      throw new AgentRuntimeError(
        "CHAT_FAILED",
        error instanceof Error ? error.message : "Chat stream failed",
        502,
      );
    }
  }
}

/** Execute an approved tool and return the result text (for resume after approval). */
export async function executeApprovedTool(
  name: string,
  args: Record<string, string>,
  tools?: AgentToolContext | null,
  clientResult?: string | null,
): Promise<string> {
  if (CLIENT_EXEC_TOOLS.has(name)) {
    const result = clientResult?.trim() || "";
    if (!result) {
      return "This tool runs on the desktop client after approval/auto-exec. No result was provided.";
    }
    // Bound client results: reject oversized or obviously forged control payloads.
    if (result.length > 200_000) {
      return "FAILED: client tool result exceeded size limit.";
    }
    return result;
  }
  if (
    EMAIL_TOOL_NAMES.has(name) ||
    SSH_TOOL_NAMES.has(name) ||
    FINNHUB_TOOL_NAMES.has(name) ||
    name === "web_search" ||
    name === "fetch_url" ||
    name === "scrape_page"
  ) {
    return runTool(name, args, tools);
  }
  return runSafeTool(name, args, tools);
}

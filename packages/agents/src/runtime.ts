import type { AiGateway, AiMessage, AiToolCall, AiToolDefinition } from "@arrab/ai";
import {
  AiGatewayError,
  BEDROCK_DEFAULT_MODEL,
  BEDROCK_PROVIDER_ID,
  isBedrockModel,
  isXaiGrokModel,
  XAI_DEFAULT_MODEL,
  XAI_PROVIDER_ID,
} from "@arrab/ai";
import { AppError } from "@arrab/core";
import type { Agent, ConversationId } from "@arrab/shared";
import { searchWeb } from "./web-search.js";

export class AgentRuntimeError extends AppError {
  constructor(code: string, message: string, statusCode = 501) {
    super(code, message, statusCode, true);
    this.name = "AgentRuntimeError";
  }
}

export interface AgentToolContext {
  workspaceSummary?: string | null;
  activeGoal?: string | null;
  teamRoster?: string | null;
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
  'CALL_TOOL propose_action {"title":"...","detail":"..."}',
  "Coding workflow: search_code → read_file → edit → verify with run_terminal. Be precise; do not invent file contents.",
  "Do not invent tool output — wait for TOOL_RESULT.",
].join("\n");

const TOOL_HINT_NATIVE = [
  "You may call tools for workspace facts, codebase search, files, patches, local shell, and live web search.",
  "Coding workflow (mandatory when a folder is attached):",
  "1) Ground yourself with search_code / list_files / read_file (and attached open file / git / terminal / @mentions / rules).",
  "2) Make concrete edits with apply_patch (preferred) or write_file.",
  "3) Verify with run_terminal (typecheck, lint, or tests). Fix from real output. Do not claim done until verified or blocked.",
  "4) Use web_search for docs, errors, or facts outside the repo.",
  "Be precise and reproducible — prefer exact paths, commands, and outcomes over personality.",
  "Never claim you lack shell/file access when a local folder is open.",
  "State clearly what you fetched, changed, or what failed.",
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
      return `Unknown tool '${name}'. Available: summarize_workspace, recall_goal, list_team, list_files, search_code, read_file, write_file, apply_patch, delete_file, rename_file, create_dir, git_status, git_diff, open_path, run_terminal, web_search, propose_action.`;
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
  return runSafeTool(name, args, tools);
}

function requiresApproval(name: string): boolean {
  return name === "propose_action" || CLIENT_EXEC_TOOLS.has(name);
}

export function isClientExecTool(name: string): boolean {
  return CLIENT_EXEC_TOOLS.has(name);
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
          : provider.id === XAI_PROVIDER_ID
            ? XAI_DEFAULT_MODEL
            : "gpt-4o-mini";
    return { provider, modelName: request.model ?? defaultModel };
  }

  private buildSystem(request: AgentRunRequest, useNativeTools: boolean): AiMessage {
    const baseSystem = [
      `You are ${request.agent.name}, an AI employee at Arrab Studio.`,
      `Your role is: ${request.agent.role}.`,
      request.agent.specialty ? `Specialty: ${request.agent.specialty}.` : null,
      request.agent.bio ? `Background / who you are:\n${request.agent.bio}` : null,
      request.agent.instructions
        ? `Standing instructions from your operator (follow carefully when anyone writes to you):\n${request.agent.instructions}`
        : null,
      "Work like a precise engineering teammate: obey standing instructions, use tools for real context, verify with commands, and never claim system access you do not have.",
      useNativeTools ? TOOL_HINT_NATIVE : TOOL_HINT,
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
    // Don't attach the full tool catalog on a plain chat — keeps first-token latency low.
    const useNativeTools = provider.supportsTools === true && hasDesk;
    const system = this.buildSystem(request, useNativeTools);
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
        tools: useNativeTools ? NATIVE_TOOLS : undefined,
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
            undefined,
        };
        yield { type: "approval_needed", tool: pendingTool };
        const awaitLabel = CLIENT_EXEC_TOOLS.has(pendingName)
          ? `Local tool awaiting desktop execution: ${pendingArgs.title}`
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
export function executeApprovedTool(
  name: string,
  args: Record<string, string>,
  tools?: AgentToolContext | null,
  clientResult?: string | null,
): string {
  if (CLIENT_EXEC_TOOLS.has(name)) {
    return (
      clientResult?.trim() ||
      "This tool runs on the desktop client after approval/auto-exec. No result was provided."
    );
  }
  return runSafeTool(name, args, tools);
}

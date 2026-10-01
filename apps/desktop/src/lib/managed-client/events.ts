import { nextBackoffMs, type Timers } from "./sync";
import {
  parseCommand,
  parseConfig,
  parseMaintenance,
  parseNotification,
  type ClientCommand,
  type ClientConfig,
  type ClientNotification,
  type Maintenance,
} from "./types";

export const EVENTS_PATH = "/v1/client/events";

export type LiveEvent =
  | { type: "maintenance"; maintenance: Maintenance }
  | { type: "config"; config: ClientConfig }
  | { type: "notification"; notification: ClientNotification }
  | { type: "command"; command: ClientCommand }
  | { type: "ping" };

/** Incremental `text/event-stream` parser (handles split chunks and CRLF). */
export function createSseParser(onMessage: (event: string, data: string) => void) {
  let buffer = "";
  let event = "";
  let data: string[] = [];

  function dispatch() {
    if (data.length) onMessage(event || "message", data.join("\n"));
    event = "";
    data = [];
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line === "") {
          dispatch();
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
    },
    reset() {
      buffer = "";
      event = "";
      data = [];
    },
  };
}

export function toLiveEvent(event: string, data: string): LiveEvent | null {
  if (event === "ping") return { type: "ping" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return null;
  }
  switch (event) {
    case "maintenance": {
      const maintenance = parseMaintenance(parsed);
      return maintenance ? { type: "maintenance", maintenance } : null;
    }
    case "config": {
      const config = parseConfig(parsed);
      return config ? { type: "config", config } : null;
    }
    case "notification": {
      const notification = parseNotification(parsed);
      return notification ? { type: "notification", notification } : null;
    }
    case "command": {
      const command = parseCommand(parsed);
      return command ? { type: "command", command } : null;
    }
    default:
      return null;
  }
}

export type LiveConnection = { close: () => void };

/** Opens one stream. Must call `onClose` exactly once when it ends or fails. */
export type LiveConnector = (handlers: {
  onOpen: () => void;
  onChunk: (text: string) => void;
  onClose: (status: number | null) => void;
}) => LiveConnection;

/**
 * One live connection per device. Any failure (missing endpoint, network,
 * server close) reconnects with backoff; polling `/client/sync` keeps running
 * underneath, so a dead channel is invisible to the user.
 */
export function createLiveChannel(deps: {
  connect: LiveConnector;
  onEvent: (event: LiveEvent) => void;
  timers?: Timers;
  random?: () => number;
}) {
  const timers: Timers = deps.timers ?? {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let connection: LiveConnection | null = null;
  let retry: unknown = null;
  let failures = 0;
  let running = false;
  let generation = 0;

  function open() {
    if (!running || connection) return;
    const mine = ++generation;
    const parser = createSseParser((event, data) => {
      const live = toLiveEvent(event, data);
      if (live) deps.onEvent(live);
    });
    let closed = false;
    connection = deps.connect({
      onOpen: () => {
        if (mine === generation) failures = 0;
      },
      onChunk: (text) => {
        if (mine === generation) parser.push(text);
      },
      onClose: () => {
        if (closed || mine !== generation) return;
        closed = true;
        connection = null;
        if (!running) return;
        failures += 1;
        retry = timers.setTimeout(() => {
          retry = null;
          open();
        }, nextBackoffMs(failures, deps.random));
      },
    });
  }

  return {
    start() {
      if (running) return;
      running = true;
      open();
    },
    stop() {
      running = false;
      generation += 1;
      if (retry !== null) timers.clearTimeout(retry);
      retry = null;
      connection?.close();
      connection = null;
    },
    isOpen: () => connection !== null,
  };
}

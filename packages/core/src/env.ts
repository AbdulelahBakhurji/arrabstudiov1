import { ValidationError } from "./errors.js";

export function readOptionalEnv(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return value;
}

export function readRequiredEnv(name: string): string {
  const value = readOptionalEnv(name);
  if (!value) {
    throw new ValidationError(`Missing required environment variable ${name}`);
  }
  return value;
}

export function parsePort(value: string, name: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ValidationError(`${name} must be an integer between 1 and 65535`);
  }
  return port;
}

export function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

import { AppError } from "@arrab/core";
import type { FastifyInstance } from "fastify";

function statusFromUnknown(error: unknown): number {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number") {
      return statusCode;
    }
  }
  return 500;
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "An unexpected error occurred";
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn({ err: error, code: error.code }, error.message);
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.expose ? error.message : "Request failed" },
      });
    }

    const statusCode = statusFromUnknown(error);
    request.log.error({ err: error }, "Unhandled error");
    return reply.status(statusCode).send({
      error: {
        code: "INTERNAL_ERROR",
        message: statusCode >= 500 ? "An unexpected error occurred" : messageFromUnknown(error),
      },
    });
  });
}

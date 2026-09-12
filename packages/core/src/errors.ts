export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly expose: boolean;

  constructor(code: string, message: string, statusCode = 500, expose = false) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.expose = expose;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      "NOT_FOUND",
      id ? `${resource} '${id}' was not found` : `${resource} was not found`,
      404,
      true,
    );
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message, 400, true);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication is required") {
    super("UNAUTHORIZED", message, 401, true);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You are not allowed to perform this action") {
    super("FORBIDDEN", message, 403, true);
    this.name = "ForbiddenError";
  }
}

export class QuotaExceededError extends AppError {
  constructor(message = "Subscription token limit reached for this billing period") {
    super("QUOTA_EXCEEDED", message, 402, true);
    this.name = "QuotaExceededError";
  }
}

export class SessionBudgetExceededError extends AppError {
  constructor(message = "This session has reached its token budget") {
    super("SESSION_BUDGET_EXCEEDED", message, 402, true);
    this.name = "SessionBudgetExceededError";
  }
}

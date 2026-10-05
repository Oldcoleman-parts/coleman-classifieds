// Custom error classes. Throw these, never strings. No server-only imports here,
// so the file is safe to import from any module.

export class AppError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, status?: number, details?: unknown }} [options]
   */
  constructor(message, { code = "APP_ERROR", status = 500, details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  /**
   * @param {string} message
   * @param {Record<string, string>} [fields] field name → problem
   */
  constructor(message, fields = {}) {
    super(message, { code: "VALIDATION", status: 400, details: fields });
    this.fields = fields;
  }
}

export class NotFoundError extends AppError {
  /** @param {string} [message] */
  constructor(message = "Not found") {
    super(message, { code: "NOT_FOUND", status: 404 });
  }
}

export class UnauthorizedError extends AppError {
  /** @param {string} [message] */
  constructor(message = "Unauthorized") {
    super(message, { code: "UNAUTHORIZED", status: 401 });
  }
}

export class ConflictError extends AppError {
  /** @param {string} [message] */
  constructor(message = "Conflict") {
    super(message, { code: "CONFLICT", status: 409 });
  }
}

export class ShopifyUserError extends AppError {
  /**
   * @param {string} message
   * @param {Array<{ field?: string[] | null, message: string, code?: string }>} [userErrors]
   */
  constructor(message, userErrors = []) {
    super(message, {
      code: "SHOPIFY_USER_ERROR",
      status: 502,
      details: userErrors,
    });
    this.userErrors = userErrors;
  }
}

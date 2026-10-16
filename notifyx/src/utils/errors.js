'use strict';

/** An error whose message is safe and useful to show to a Discord user. */
class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}

/** A failed call to an external HTTP API (message never contains URLs or keys). */
class ApiError extends Error {
  constructor(message, { status = 0, reason = '', retryable = false, retryAfterMs = 0 } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

/** The API's daily quota is exhausted until `resetAt`. */
class QuotaError extends Error {
  constructor(resetAt) {
    super('API quota exhausted');
    this.name = 'QuotaError';
    this.resetAt = resetAt;
  }
}

module.exports = { UserError, ApiError, QuotaError };

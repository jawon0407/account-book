/**
 * Error whose public code and message are safe to print without secret values.
 */
export class SecurityGateError extends Error {
  /**
   * @param {string} code Stable machine-readable failure identifier.
   * @param {string} message Sanitized explanation safe for terminal and CI logs.
   */
  constructor(code, message) {
    super(message);
    this.name = "SecurityGateError";
    this.code = code;
  }
}

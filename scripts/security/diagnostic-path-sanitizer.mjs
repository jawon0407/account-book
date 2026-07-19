/**
 * Credential signatures recognized by both blob scanning and diagnostic redaction.
 * Patterns intentionally omit global state because scanner callers reuse them across blobs.
 */
export const SECRET_RULES = Object.freeze([
  { ruleId: "AWS_ACCESS_KEY_ID", pattern: /(?:AKIA|ASIA)[0-9A-Z]{16}/u },
  {
    ruleId: "GITHUB_TOKEN",
    pattern: /(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/u,
  },
  {
    ruleId: "PRIVATE_KEY",
    pattern: /-----BEGIN (?:(?:RSA|EC|OPENSSH|DSA|ENCRYPTED) )?PRIVATE KEY-----/u,
  },
]);

/**
 * Redacts supported credential signatures and makes Unicode format controls visible.
 * This function assumes its input is an untrusted repository path and therefore never
 * throws for an unexpected value; non-string paths return a stable safe placeholder.
 *
 * @param {unknown} path Repository-controlled path intended for a public diagnostic.
 * @returns {string} Deterministic path text with credentials replaced by rule labels and
 * Unicode format controls represented as literal Unicode escape text.
 */
export function sanitizeDiagnosticPath(path) {
  if (typeof path !== "string") return "[INVALID_PATH]";

  let sanitized = path;
  for (const { ruleId, pattern } of SECRET_RULES) {
    const allMatches = new RegExp(pattern.source, "gu");
    sanitized = sanitized.replace(allMatches, `[REDACTED:${ruleId}]`);
  }
  return sanitized.replace(/\p{Cf}/gu, (control) => {
    const codePoint = control.codePointAt(0);
    return `\\u${codePoint.toString(16).padStart(4, "0")}`;
  });
}

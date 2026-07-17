const SECRET_RULES = Object.freeze([
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
 * Detects supported credential signatures in exact blob bytes.
 * Regex matches are reduced immediately to paths and stable rule IDs; matched
 * substrings are never retained in findings or diagnostics.
 *
 * @param {Array<{path: string, content: Buffer}>} blobs Exact blobs from pushed commits.
 * @returns {Array<{path: string, ruleId: string}>} Sanitized deterministic findings.
 */
export function scanBlobsForSecrets(blobs) {
  const findings = [];
  for (const { path, content } of blobs) {
    const text = content.toString("latin1");
    for (const { ruleId, pattern } of SECRET_RULES) {
      if (pattern.test(text)) findings.push({ path, ruleId });
    }
  }
  return findings.sort((left, right) => {
    const leftKey = `${left.path}\0${left.ruleId}`;
    const rightKey = `${right.path}\0${right.ruleId}`;
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    return 0;
  });
}

/**
 * Formats sanitized findings for terminal/CI display with untrusted paths escaped.
 *
 * @param {Array<{path: string, ruleId: string}>} findings Sanitized scan findings.
 * @returns {string} Multi-line report containing only escaped paths and rule IDs.
 */
export function formatSecretFindings(findings) {
  return [
    "Potential secrets detected; matched values are intentionally hidden:",
    ...findings.map(
      ({ path, ruleId }) => `- ${JSON.stringify(path)}: ${ruleId}`,
    ),
  ].join("\n");
}

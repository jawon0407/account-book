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
 * 파일 경로 안의 지원하는 비밀값 패턴을 가리고 눈에 안 보이는 Unicode 서식 문자를 표시한다.
 * 경로도 저장소 작성자가 조작할 수 있으므로 오류 메시지에 넣기 전에 이 처리를 거친다.
 * @param {unknown} path 터미널이나 CI 로그에 표시할 신뢰하지 않는 경로.
 * @returns {string} 비밀값은 규칙 이름으로 대체하고 서식 제어문자는 Unicode 이스케이프 글자로 표시한 문자열. 문자열이 아니면 [INVALID_PATH].
 * @remarks 원본 경로나 파일을 바꾸지 않으며 등록된 규칙 밖의 모든 비밀값을 탐지한다는 보장은 없다.
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

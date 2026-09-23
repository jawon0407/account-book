import {
  SECRET_RULES,
  sanitizeDiagnosticPath,
} from "./diagnostic-path-sanitizer.mjs";

/**
 * blob 바이트를 latin1 문자열로 읽고 등록된 AWS·GitHub 토큰·개인키 패턴이 있는지 검사한다.
 * 발견한 비밀값 자체는 보관하지 않으며 경로와 규칙 ID로만 결과를 만들고 일정한 순서로 정렬한다.
 * @param {Array<{path: string, content: Buffer}>} blobs 푸시 대상 커밋에서 읽은 파일 경로와 정확한 내용 바이트.
 * @returns {Array<{path: string, ruleId: string}>} 경로와 탐지 규칙 목록. 경로는 아직 원문이므로 공개 출력 전에 formatSecretFindings를 거쳐야 한다.
 * @remarks 파일이나 입력 배열은 변경하지 않는다. 등록한 패턴 외의 모든 비밀값을 탐지하는 것은 아니다.
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
 * 검사 결과를 터미널·CI용 여러 줄 보고서로 만든다. 경로 속 비밀값을 가리고 JSON 문자열로 이스케이프한다.
 * @param {Array<{path: string, ruleId: string}>} findings 내부 스캐너가 만든 경로와 고정 규칙 ID 목록.
 * @returns {string} 일치한 비밀값 없이 정화된 경로와 규칙 ID만 담는 보고서. 이 함수가 직접 출력하지는 않는다.
 */
export function formatSecretFindings(findings) {
  return [
    "Potential secrets detected; matched values are intentionally hidden:",
    ...findings.map(
      ({ path, ruleId }) => `- ${JSON.stringify(sanitizeDiagnosticPath(path))}: ${ruleId}`,
    ),
  ].join("\n");
}

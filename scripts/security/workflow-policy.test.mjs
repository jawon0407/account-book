import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workflowPath = fileURLToPath(
  new URL("../../.github/workflows/security-gate.yml", import.meta.url),
);
const pullRequestTemplatePath = fileURLToPath(
  new URL("../../.github/pull_request_template.md", import.meta.url),
);

const approvedActions = [
  "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
];
const reviewedWorkflowSha256 =
  "ced83548a6edcfca6d95dbb4ea72687de446177c9331cf533e7f0f4a52dc761b";
const disposableDatabaseUrl =
  "postgresql://postgres:postgres@127.0.0.1:5432/account_book_test";
const postgresImage =
  "postgres:17@sha256:cb875afe6d2e8593c28c22d37d0fd7aaf035c43a42e2f7792cd4c09ceb6beac5";

/**
 * 줄바꿈 CRLF만 LF로 통일한 뒤 워크플로 전체의 해시를 계산한다.
 * @param source - 검토 대상 YAML 원문.
 * @returns 승인된 원문 해시와 비교할 SHA-256 16진수 문자열.
 */
function canonicalWorkflowDigest(source) {
  const normalizedSource = source.replace(/\r\n/gu, "\n");
  return createHash("sha256").update(normalizedSource, "utf8").digest("hex");
}

/**
 * 줄 시작 또는 공백 뒤 #부터를 주석으로 간주해 제거한다. 완전한 YAML 파서가 아닌 테스트용 단순 규칙이다.
 * @param line - YAML 한 줄.
 * @returns 단순 주석과 뒤 공백을 제거한 줄.
 */
function stripYamlComment(line) {
  const comment = /(^|\s)#/u.exec(line);
  return (comment ? line.slice(0, comment.index) : line).trimEnd();
}

/**
 * 주석과 빈 줄을 제외해 실제 설정 비교에 필요한 줄만 남긴다.
 * @param lines - YAML 줄 목록.
 * @returns 들여쓰기는 유지한 유효 줄 목록.
 */
function activeLines(lines) {
  return lines.map(stripYamlComment).filter((line) => line.trim().length > 0);
}

/**
 * 블록 경계 판단에 사용할 앞쪽 공백 수를 센다.
 * @param line - YAML 한 줄.
 * @returns 연속된 선행 스페이스 개수. 탭은 세지 않는다.
 */
function indentation(line) {
  return /^ */u.exec(line)[0].length;
}

/**
 * 들여쓰기 없는 key: 행부터 다음 최상위 행 전까지를 블록으로 모은다.
 * @param source - YAML 전체 원문.
 * @param key - 찾을 최상위 키 이름.
 * @returns 일치하는 원문 줄 배열들의 목록.
 */
function topLevelBlocks(source, key) {
  const lines = source.split(/\r?\n/u);
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = stripYamlComment(lines[index]);
    if (indentation(line) !== 0 || !line.startsWith(`${key}:`)) {
      continue;
    }

    let end = index + 1;
    while (end < lines.length) {
      const candidate = stripYamlComment(lines[end]);
      if (candidate.trim().length > 0 && indentation(candidate) === 0) {
        break;
      }
      end += 1;
    }
    blocks.push(lines.slice(index, end));
  }

  return blocks;
}

/**
 * 최상위 키가 정확히 한 번 선언되었는지 단언한 뒤 블록을 돌려준다.
 * @param source - YAML 전체 원문.
 * @param key - 중복 없이 존재해야 할 키.
 * @returns 단일 블록의 원문 줄 목록. 없거나 중복이면 테스트 실패.
 */
function singleTopLevelBlock(source, key) {
  const blocks = topLevelBlocks(source, key);
  assert.equal(blocks.length, 1, `expected one top-level ${key} block`);
  return blocks[0];
}

/**
 * 단순 uses: 선언에서 GitHub Action 참조를 추출한다.
 * @param lines - 검사할 YAML 줄 목록.
 * @returns action@SHA 등 선언된 참조 문자열 목록.
 */
function actionReferences(lines) {
  return activeLines(lines).flatMap((line) => {
    const match = /^\s*(?:-\s*)?uses:\s+(\S+)$/u.exec(line);
    return match ? [match[1]] : [];
  });
}

/**
 * 주석을 제외한 원문에서 따옴표·흐름식 객체로 쓴 키도 정규식으로 찾는다.
 * @param source - YAML 원문.
 * @param key - 내부 테스트가 지정한 키 이름.
 * @returns 발견된 정규식 일치 목록. 임의 YAML 의미를 해석하지는 않는다.
 */
function yamlKeyOccurrences(source, key) {
  const lines = activeLines(source.split(/\r?\n/u));
  const keyPattern = new RegExp(
    `(?:^|[\\s{,])(?:${key}|'${key}'|"${key}")\\s*:`,
    "gu",
  );
  return lines.flatMap((line) => [...line.matchAll(keyPattern)]);
}

/**
 * write와 write-all 권한값 표기를 찾아 읽기 전용 정책을 우회하는 설정을 검사한다.
 * @param source - YAML 원문.
 * @returns 주석을 제외한 쓰기 권한값 정규식 일치 목록.
 */
function dangerousPermissionValues(source) {
  const valuePattern =
    /(?:^|[\s:{,[])\s*(?:"(?:write|write-all)"|'(?:write|write-all)'|write|write-all)(?=\s*(?:[,}\]]|$))/gu;
  return activeLines(source.split(/\r?\n/u)).flatMap((line) => [
    ...line.matchAll(valuePattern),
  ]);
}

/**
 * 동적 접근 표기에도 포함되는 secrets 단어를 찾아 저장소 비밀값 참조를 검사한다.
 * @param source - YAML 원문.
 * @returns 주석 밖에서 발견한 secrets 토큰 일치 목록.
 */
function activeSecretTokens(source) {
  const secretPattern = /(?:^|[^A-Za-z0-9_-])secrets(?=$|[^A-Za-z0-9_-])/gu;
  return activeLines(source.split(/\r?\n/u)).flatMap((line) => [
    ...line.matchAll(secretPattern),
  ]);
}

/**
 * steps: 안에서 두 칸 더 들여쓴 목록 항목을 기준으로 실행 단계들을 나눈다.
 * @param source - 워크플로 YAML 원문.
 * @returns 각 단계에 해당하는 원문 줄 배열 목록.
 */
function stepBlocks(source) {
  const lines = source.split(/\r?\n/u);
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    const stepsLine = stripYamlComment(lines[index]);
    if (!/^\s*steps:\s*$/u.test(stepsLine)) {
      continue;
    }

    const stepsIndent = indentation(stepsLine);
    let end = index + 1;
    while (end < lines.length) {
      const candidate = stripYamlComment(lines[end]);
      if (candidate.trim().length > 0 && indentation(candidate) <= stepsIndent) {
        break;
      }
      end += 1;
    }

    const starts = [];
    for (let stepIndex = index + 1; stepIndex < end; stepIndex += 1) {
      const candidate = stripYamlComment(lines[stepIndex]);
      if (
        candidate.trimStart().startsWith("- ") &&
        indentation(candidate) === stepsIndent + 2
      ) {
        starts.push(stepIndex);
      }
    }

    for (let stepIndex = 0; stepIndex < starts.length; stepIndex += 1) {
      const start = starts[stepIndex];
      const finish = starts[stepIndex + 1] ?? end;
      blocks.push(lines.slice(start, finish));
    }
  }

  return blocks;
}

/**
 * 지정한 중첩 키 뒤의 더 깊게 들여쓴 설정 행을 추출한다.
 * @param block - 단계 등 상위 블록의 줄 목록.
 * @param key - with 또는 env 같은 중첩 키.
 * @returns 주석·빈 줄을 제외한 내부 줄. 키가 없으면 테스트 실패.
 */
function nestedBlockContent(block, key) {
  const keyIndex = block.findIndex(
    (line) => stripYamlComment(line).trim() === `${key}:`,
  );
  assert.notEqual(keyIndex, -1, `missing ${key} block`);

  const keyLine = stripYamlComment(block[keyIndex]);
  const keyIndent = indentation(keyLine);
  const content = [];
  for (let index = keyIndex + 1; index < block.length; index += 1) {
    const line = stripYamlComment(block[index]);
    if (line.trim().length === 0) {
      continue;
    }
    if (indentation(line) <= keyIndent) {
      break;
    }
    content.push(line);
  }
  return content;
}

/**
 * run: >- 뒤의 여러 줄 명령을 공백으로 이어 실행 순서 비교용 문자열로 만든다.
 * @param block - 검사할 단계의 원문 줄 목록.
 * @returns 접힌 명령 문자열. 실행하지 않으며 해당 run 선언이 없으면 테스트 실패.
 */
function foldedRunCommand(block) {
  const runIndex = block.findIndex(
    (line) => stripYamlComment(line).trim() === "run: >-",
  );
  assert.notEqual(runIndex, -1, "missing folded run command");

  const runLine = stripYamlComment(block[runIndex]);
  const runIndent = indentation(runLine);
  const commandLines = [];
  for (let index = runIndex + 1; index < block.length; index += 1) {
    const line = stripYamlComment(block[index]);
    if (line.trim().length === 0) {
      continue;
    }
    if (indentation(line) <= runIndent) {
      break;
    }
    commandLines.push(line.trim());
  }
  return commandLines.join(" ");
}

// This whole-source digest is the fail-closed backstop for YAML syntax that the
// lightweight structural diagnostics below intentionally do not parse.
test("security workflow matches the reviewed canonical source", () => {
  const source = readFileSync(workflowPath, "utf8");

  assert.equal(canonicalWorkflowDigest(source), reviewedWorkflowSha256);
});

test("security workflow has only pull_request and push triggers", () => {
  const source = readFileSync(workflowPath, "utf8");
  const triggerBlock = activeLines(singleTopLevelBlock(source, "on"));

  assert.deepEqual(triggerBlock, ["on:", "  pull_request:", "  push:"]);
});

test("push runs use unique run-ID groups, never SHA grouping, and only PR runs are cancellable", () => {
  const source = readFileSync(workflowPath, "utf8");
  const concurrencyBlock = activeLines(
    singleTopLevelBlock(source, "concurrency"),
  );

  assert.deepEqual(concurrencyBlock, [
    "concurrency:",
    "  group: security-gate-${{ github.event_name }}-${{ github.event_name == 'push' && github.run_id || github.event.pull_request.number }}",
    "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
  ]);
  assert.equal(
    concurrencyBlock.some((line) => line.includes("github.event_name == 'push' && github.sha")),
    false,
    "push concurrency must not group by github.sha",
  );
});

test("security workflow grants only top-level contents read permission", () => {
  const source = readFileSync(workflowPath, "utf8");
  const declarations = yamlKeyOccurrences(source, "permissions");

  assert.equal(declarations.length, 1);
  assert.deepEqual(activeLines(singleTopLevelBlock(source, "permissions")), [
    "permissions:",
    "  contents: read",
  ]);
  assert.equal(dangerousPermissionValues(source).length, 0);
});

test("security workflow does not reference repository secrets", () => {
  const source = readFileSync(workflowPath, "utf8");

  assert.equal(activeSecretTokens(source).length, 0);
});

test("security workflow uses exactly the approved SHA-pinned actions", () => {
  const source = readFileSync(workflowPath, "utf8");

  assert.equal(yamlKeyOccurrences(source, "uses").length, 2);
  assert.deepEqual(actionReferences(source.split(/\r?\n/u)), approvedActions);
});

test("checkout step disables shallow history and persisted credentials", () => {
  const source = readFileSync(workflowPath, "utf8");
  const checkoutSteps = stepBlocks(source).filter((block) =>
    actionReferences(block).some((action) => action.startsWith("actions/checkout@")),
  );

  assert.equal(checkoutSteps.length, 1);
  assert.deepEqual(
    nestedBlockContent(checkoutSteps[0], "with").map((line) => line.trim()),
    ["fetch-depth: 0", "persist-credentials: false"],
  );
});

test("security workflow uses the reviewed disposable PostgreSQL service", () => {
  const source = readFileSync(workflowPath, "utf8");
  const lines = activeLines(source.split(/\r?\n/u)).map((line) => line.trim());

  assert.equal(lines.filter((line) => line === `image: ${postgresImage}`).length, 1);
  assert.equal(lines.filter((line) => line === "- 5432:5432").length, 1);
  assert.ok(lines.includes("POSTGRES_DB: account_book_test"));
  assert.ok(lines.includes("POSTGRES_PASSWORD: postgres"));
  assert.ok(lines.includes("POSTGRES_USER: postgres"));
  assert.ok(lines.some((line) => line.includes("--health-cmd") && line.includes("pg_isready")));
});

test("security workflow runs install and every security gate in reviewed order", () => {
  const source = readFileSync(workflowPath, "utf8");
  const steps = stepBlocks(source);
  const commands = steps.map((block) => {
    if (block.some((line) => stripYamlComment(line).trim() === "run: >-")) return foldedRunCommand(block);
    const runLine = activeLines(block).find((line) => /^\s+run:\s+/u.test(line));
    return runLine?.trim().replace(/^run:\s+/u, "") ?? "";
  });
  const required = [
    "corepack enable",
    "pnpm install --frozen-lockfile",
    "pnpm run verify",
    "pnpm --filter @account-book/web test:coverage",
    "pnpm test:db",
    "pnpm --filter @account-book/database-tests prepare:e2e",
    "pnpm --filter @account-book/e2e exec playwright install --with-deps chromium",
    "pnpm --filter @account-book/e2e test",
    "pnpm audit --prod --audit-level high",
  ];
  let previous = -1;
  for (const command of required) {
    const index = commands.findIndex((candidate) => candidate === command);
    assert.ok(index > previous, `${command} must appear once and in order`);
    assert.equal(commands.filter((candidate) => candidate === command).length, 1);
    previous = index;
  }
  assert.match(commands.at(-1) ?? "", /^node scripts\/security-gate\.mjs --mode ci/u);
});

test("database preparation and browser gates use only the disposable server-side database boundary", () => {
  const source = readFileSync(workflowPath, "utf8");
  const steps = stepBlocks(source);
  /**
   * 정확한 단일 행 run 명령이 있는 단계를 찾는 지역 헬퍼다.
   * @param command - 찾을 실행 명령 문자열.
   * @returns 처음 일치한 단계 또는 undefined. 명령은 실행하지 않는다.
   */
  const stepFor = (command) => steps.find((block) => activeLines(block).some((line) => line.trim() === `run: ${command}`));
  const database = stepFor("pnpm test:db");
  const preparation = stepFor("pnpm --filter @account-book/database-tests prepare:e2e");
  const browser = stepFor("pnpm --filter @account-book/e2e test");

  assert.ok(database, "missing database test step");
  assert.ok(preparation, "missing E2E database preparation step");
  assert.ok(browser, "missing browser E2E step");
  assert.deepEqual(nestedBlockContent(database, "env").map((line) => line.trim()), [
    `TEST_DATABASE_URL: ${disposableDatabaseUrl}`,
    "TEST_DATABASE_DISPOSABLE: 'true'",
  ]);
  assert.deepEqual(nestedBlockContent(preparation, "env").map((line) => line.trim()), [
    `TEST_DATABASE_URL: ${disposableDatabaseUrl}`,
    "TEST_DATABASE_DISPOSABLE: 'true'",
  ]);
  assert.deepEqual(nestedBlockContent(browser, "env").map((line) => line.trim()), [
    `DATABASE_URL: ${disposableDatabaseUrl}`,
    `TEST_DATABASE_URL: ${disposableDatabaseUrl}`,
    "TEST_DATABASE_DISPOSABLE: 'true'",
  ]);
});

test("security workflow wires the authoritative CI backstop", () => {
  const source = readFileSync(workflowPath, "utf8");
  const backstopSteps = stepBlocks(source).filter((block) =>
    activeLines(block).includes(
      "      - name: Evaluate pushed or proposed commit range",
    ),
  );

  assert.equal(backstopSteps.length, 1);
  assert.equal(
    foldedRunCommand(backstopSteps[0]),
    'node scripts/security-gate.mjs --mode ci --event "$EVENT_NAME" ' +
      '--target-ref "$TARGET_REF" --base "$BASE_SHA" --head "$HEAD_SHA"',
  );
  assert.deepEqual(
    nestedBlockContent(backstopSteps[0], "env").map((line) => line.trim()),
    [
      "EVENT_NAME: ${{ github.event_name }}",
      "TARGET_REF: ${{ github.event_name == 'pull_request' && format('refs/heads/{0}', github.base_ref) || github.ref }}",
      "BASE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before }}",
      "HEAD_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}",
    ],
  );
});

test("policy scanner recognizes quoted and flow-style security keys", () => {
  const quotedActionSha = "a".repeat(40);
  const flowActionSha = "b".repeat(40);
  const source = `
permissions:
  contents: read
jobs:
  quoted:
    'permissions':
      contents: 'write'
    steps:
      - name: Quoted action key
        "uses": example/quoted@${quotedActionSha}
  flow:
    metadata: { "permissions": { id-token: "write-all" }, 'uses': example/flow@${flowActionSha} }
`;

  assert.deepEqual(
    {
      permissions: yamlKeyOccurrences(source, "permissions").length,
      uses: yamlKeyOccurrences(source, "uses").length,
    },
    { permissions: 3, uses: 2 },
  );
});

test("policy scanner recognizes quoted and flow-style write values", () => {
  const source = `
permissions:
  contents: 'write'
  id-token: "write"
jobs: { example: { permissions: write-all } }
`;

  assert.equal(dangerousPermissionValues(source).length, 3);
});

test("policy scanner recognizes spaced and dynamic secret tokens", () => {
  const source = `
env:
  SPACED: \${{ secrets ['TOKEN'] }}
  DYNAMIC: \${{ secrets[format('TOKEN')] }}
  # COMMENTED: \${{ secrets.IGNORED }}
`;

  assert.equal(activeSecretTokens(source).length, 2);
});

test("pull request template keeps its Korean policy evidence in UTF-8", () => {
  const source = readFileSync(pullRequestTemplatePath, "utf8");
  const lines = source.split(/\r?\n/u);
  const requiredLines = [
    "## 변경 목적과 범위",
    "## 검증 증거",
    "## 보안 영향",
    "## 데이터베이스와 롤백",
    "## 알려진 잔여 위험",
    "- [ ] PR head SHA와 CI가 검사한 SHA가 같다.",
    "- [ ] 코드, diff, 로그, fixture에 실제 비밀정보나 재무 데이터가 없다.",
    "- [ ] GitHub 무료 플랜에서 main 보호와 push protection이 강제되지 않는 잔여 위험을 확인했다.",
    "- [ ] 마이그레이션 없음 또는 마이그레이션·롤백 절차를 기록했다.",
    "- 위험:",
    "- 수용 또는 후속 조치:",
  ];

  for (const line of requiredLines) {
    assert.ok(lines.includes(line), `missing UTF-8 policy line: ${line}`);
  }
  assert.ok(!lines.includes("## 蹂寃?紐⑹쟻怨?踰붿쐞"));
});

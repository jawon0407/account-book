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
  "b7fcc5b67baefb0fb7d699d29cb6db794e05b93ccf29d1da1d14ef87061e3b65";

function canonicalWorkflowDigest(source) {
  const normalizedSource = source.replace(/\r\n/gu, "\n");
  return createHash("sha256").update(normalizedSource, "utf8").digest("hex");
}

function stripYamlComment(line) {
  const comment = /(^|\s)#/u.exec(line);
  return (comment ? line.slice(0, comment.index) : line).trimEnd();
}

function activeLines(lines) {
  return lines.map(stripYamlComment).filter((line) => line.trim().length > 0);
}

function indentation(line) {
  return /^ */u.exec(line)[0].length;
}

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

function singleTopLevelBlock(source, key) {
  const blocks = topLevelBlocks(source, key);
  assert.equal(blocks.length, 1, `expected one top-level ${key} block`);
  return blocks[0];
}

function actionReferences(lines) {
  return activeLines(lines).flatMap((line) => {
    const match = /^\s*(?:-\s*)?uses:\s+(\S+)$/u.exec(line);
    return match ? [match[1]] : [];
  });
}

function yamlKeyOccurrences(source, key) {
  const lines = activeLines(source.split(/\r?\n/u));
  const keyPattern = new RegExp(
    `(?:^|[\\s{,])(?:${key}|'${key}'|"${key}")\\s*:`,
    "gu",
  );
  return lines.flatMap((line) => [...line.matchAll(keyPattern)]);
}

function dangerousPermissionValues(source) {
  const valuePattern =
    /(?:^|[\s:{,\[])\s*(?:"(?:write|write-all)"|'(?:write|write-all)'|write|write-all)(?=\s*(?:[,}\]]|$))/gu;
  return activeLines(source.split(/\r?\n/u)).flatMap((line) => [
    ...line.matchAll(valuePattern),
  ]);
}

function activeSecretTokens(source) {
  const secretPattern = /(?:^|[^A-Za-z0-9_-])secrets(?=$|[^A-Za-z0-9_-])/gu;
  return activeLines(source.split(/\r?\n/u)).flatMap((line) => [
    ...line.matchAll(secretPattern),
  ]);
}

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

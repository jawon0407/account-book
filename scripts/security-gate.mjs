import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SecurityGateError } from "./security/errors.mjs";
import { runSecurityGate } from "./security/gate.mjs";
import { parsePrePushInput } from "./security/push-policy.mjs";

const VALUE_OPTIONS = new Map([
  ["--mode", { key: "mode", modes: ["pre-push", "ci"] }],
  ["--root", { key: "rootDir", modes: ["pre-push", "ci"] }],
  ["--event", { key: "eventName", modes: ["ci"] }],
  ["--target-ref", { key: "targetRef", modes: ["ci"] }],
  ["--base", { key: "base", modes: ["ci"] }],
  ["--head", { key: "head", modes: ["ci"] }],
  ["--remote-name", { key: "remoteName", modes: ["pre-push"] }],
  ["--remote-url", { key: "remoteUrl", modes: ["pre-push"] }],
]);

/**
 * 잘못된 CLI 입력값을 출력하지 않도록 고정된 인자 오류를 만든다.
 * @returns {SecurityGateError} 호출자가 throw할 수 있는 INVALID_ARGUMENT 오류 객체.
 */
function invalidArguments() {
  return new SecurityGateError(
    "INVALID_ARGUMENT",
    "Invalid command-line arguments.",
  );
}

/**
 * CLI 인자를 옵션·값 쌍으로 읽고 실행 모드별로 허용되는 옵션인지 검사한다.
 * 루트 경로는 절대 경로로 바꾸지만 Git이나 보안 검사는 아직 실행하지 않는다.
 * @param {string[]} args 스크립트 경로 뒤에 전달된 명령줄 인자 목록.
 * @returns {{mode: "pre-push"|"ci", rootDir: string, eventName?: string, targetRef?: string, base?: string, head?: string, remoteName?: string, remoteUrl?: string}} 검증한 모드·루트와 해당 모드에 필요한 이벤트·커밋 범위·원격 메타데이터.
 * @throws {SecurityGateError} 중복·미지원 옵션, 값 누락, 잘못된 모드, 모드와 맞지 않는 옵션, CI 필수값 누락이면 발생한다. 오류에 입력값은 담지 않는다.
 */
function parseArguments(args) {
  const options = { rootDir: process.cwd() };
  const providedOptions = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const definition = VALUE_OPTIONS.get(option);
    const value = args[index + 1];
    if (
      !definition ||
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--") ||
      providedOptions.has(option)
    ) {
      throw invalidArguments();
    }
    providedOptions.add(option);
    options[definition.key] = definition.key === "rootDir" ? resolve(value) : value;
  }

  if (options.mode !== "pre-push" && options.mode !== "ci") {
    throw new SecurityGateError("INVALID_MODE", "Mode must be pre-push or ci.");
  }
  if (
    [...providedOptions].some(
      (option) => !VALUE_OPTIONS.get(option).modes.includes(options.mode),
    )
  ) {
    throw invalidArguments();
  }
  if (
    options.mode === "ci" &&
    [options.eventName, options.targetRef, options.base, options.head].some(
      (value) => typeof value !== "string" || value.length === 0,
    )
  ) {
    throw new SecurityGateError(
      "CI_ARGUMENTS_REQUIRED",
      "CI mode requires event, target-ref, base, and head.",
    );
  }
  return options;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.mode === "pre-push") {
    options.updates = parsePrePushInput(readFileSync(0, "utf8"));
  }
  const result = runSecurityGate(options);
  console.log(`Security gate passed; scanned ${result.scannedBlobCount} changed blobs.`);
} catch (error) {
  const code = error instanceof SecurityGateError ? error.code : "UNEXPECTED_FAILURE";
  const message = error instanceof SecurityGateError
    ? error.message
    : "Security gate failed without a safe diagnostic.";
  console.error(`[${code}] ${message}`);
  process.exitCode = 1;
}

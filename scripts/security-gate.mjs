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

function invalidArguments() {
  return new SecurityGateError(
    "INVALID_ARGUMENT",
    "Invalid command-line arguments.",
  );
}

/**
 * Parses public CLI options without including untrusted values in diagnostics.
 *
 * @param {string[]} args Process arguments after the script path.
 * @returns {{mode: "pre-push"|"ci", rootDir: string, eventName?: string, targetRef?: string, base?: string, head?: string, remoteName?: string, remoteUrl?: string}} Common root/mode values; CI-only event/range values; and optional pre-push-only remote metadata.
 * @throws {SecurityGateError} With fixed text for duplicates, unsupported options,
 * missing values, mode-incompatible options, invalid mode, or incomplete CI input.
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

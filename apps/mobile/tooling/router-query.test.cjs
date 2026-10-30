const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createRequire, Module } = require("node:module");
const path = require("node:path");
const { test } = require("node:test");

const routerRoot = path.dirname(require.resolve("expo-router/package.json"));
const routerRequire = createRequire(path.join(routerRoot, "package.json"));
const { getStateFromPath } = require(
  path.join(routerRoot, "build/react-navigation/core/getStateFromPath.js"),
);
const { getPathFromState } = require(
  path.join(routerRoot, "build/react-navigation/core/getPathFromState.js"),
);
const config = { screens: { ledger: "ledger" } };

// These first three cases cover the vendored React Navigation core. Expo's
// active fork has different parsing semantics and is checked separately below.
test("Navigation core parses Korean labels, repeated filters, spaces and escaped separators", () => {
  const state = getStateFromPath(
    "/ledger?label=%EA%B5%AD%EB%AF%BC&category=game&category=food&memo=a%26b+%2B&empty=",
    config,
  );
  assert.deepEqual(
    { ...state.routes[0].params },
    {
      label: "국민",
      category: ["game", "food"],
      memo: "a&b +",
      empty: "",
    },
  );
});

test("Navigation core serializes and restores scalar query values", () => {
  const params = { category: "game", memo: "체육관 + 식사", empty: "" };
  const url = getPathFromState(
    { routes: [{ name: "ledger", params }] },
    config,
  );
  const restored = getStateFromPath(url, config);
  assert.deepEqual({ ...restored.routes[0].params }, params);
});

test("Navigation core malformed query completes within an isolated five-second budget", () => {
  const parserPath = routerRequire.resolve(
    "./build/react-navigation/core/getStateFromPath.js",
  );
  // Use a child process: a vulnerable synchronous decoder cannot stall the test
  // runner indefinitely. Its controlled script performs no network or file writes.
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `const { getStateFromPath } = require(${JSON.stringify(parserPath)});
       const input = '%FF'.repeat(1500);
       const state = getStateFromPath('/ledger?memo=' + input, { screens: { ledger: 'ledger' } });
       if (state.routes[0].params.memo !== input) process.exit(2);`,
    ],
    { timeout: 5000, encoding: "utf8", maxBuffer: 4096 },
  );
  assert.equal(
    result.error,
    undefined,
    "malformed URL must not exhaust the decoder time budget",
  );
  assert.equal(result.status, 0, result.stderr);
});

/**
 * Load Expo's real routing functions without loading React Native UI in Node.
 * The platform barrel is replaced by its real pure validator; query parsing,
 * serialization and decoder dependencies remain the installed implementations.
 * @returns The installed Expo fork's pure path/state conversion exports.
 */
function loadExpoRouting() {
  const nativePath = path.join(
    routerRoot,
    "build/react-navigation/native/index.js",
  );
  const previous = require.cache[nativePath];
  const shim = new Module(nativePath);
  shim.exports = require(
    path.join(routerRoot, "build/react-navigation/core/validatePathConfig.js"),
  );
  shim.loaded = true;
  require.cache[nativePath] = shim;
  try {
    return {
      ...require(path.join(routerRoot, "build/fork/getStateFromPath.js")),
      ...require(path.join(routerRoot, "build/fork/getPathFromState.js")),
    };
  } finally {
    if (previous) require.cache[nativePath] = previous;
    else delete require.cache[nativePath];
  }
}

test("Expo active fork preserves Korean labels and repeated filters on round trip", () => {
  const expoRouting = loadExpoRouting();
  const params = {
    category: ["game", "food"],
    memo: "체육관 + 식사",
    empty: "",
  };
  const url = expoRouting.getPathFromState(
    { routes: [{ name: "ledger", params }] },
    config,
  );
  const state = expoRouting.getStateFromPath(url, config);
  assert.deepEqual({ ...state.routes[0].params }, params);
});

test("Expo active fork retains URLSearchParams malformed-byte semantics", () => {
  const expoRouting = loadExpoRouting();
  const state = expoRouting.getStateFromPath(
    "/ledger?memo=%FF%FF&label=%EA%B5%AD%EB%AF%BC",
    config,
  );
  assert.equal(state.routes[0].params.memo, "\uFFFD\uFFFD");
  assert.equal(state.routes[0].params.label, "국민");
});

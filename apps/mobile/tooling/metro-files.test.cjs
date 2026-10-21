const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { test } = require("node:test");

const expoRequire = createRequire(require.resolve("expo/package.json"));
const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
const packageRoot = path.dirname(
  cliRequire.resolve("@expo/metro-file-map/package.json"),
);
const crawl = require(
  path.join(packageRoot, "build/crawlers/node/index.js"),
).default;
const createFallback = require(
  path.join(packageRoot, "build/crawlers/node/fallback.js"),
).default;
const root = path.dirname(require.resolve("react/package.json"));

// Windows cloud/reparse entries can claim to be symlinks in readdir while lstat
// correctly reports a regular file. Exercise the installed crawler, not a copied algorithm.
test(
  "Metro confirms Windows reparse file type with lstat",
  { skip: process.platform !== "win32" },
  async (t) => {
    t.mock.method(fs, "readdir", (_directory, _options, callback) =>
      callback(null, [
        {
          name: "index.js",
          isDirectory: () => false,
          isSymbolicLink: () => true,
        },
      ]),
    );
    const result = await crawl({
      rootDir: root,
      roots: [root],
      extensions: ["js"],
      includeSymlinks: true,
      ignore: () => false,
      console,
      previousState: {
        fileSystem: {
          getMtimeByNormalPath: () => null,
          getDifference: (files) => files,
        },
      },
    });
    assert.equal(result.get("index.js")[4], 0);
  },
);
test(
  "Metro preserves actual junctions/symlinks",
  { skip: process.platform !== "win32" },
  async (t) => {
    t.mock.method(fs, "readdir", (_directory, _options, callback) =>
      callback(null, [
        {
          name: "index.js",
          isDirectory: () => false,
          isSymbolicLink: () => true,
        },
      ]),
    );
    t.mock.method(fs, "lstatSync", () => ({ isSymbolicLink: () => true }));
    const result = await crawl({
      rootDir: root,
      roots: [root],
      extensions: ["js"],
      includeSymlinks: true,
      ignore: () => false,
      console,
      previousState: {
        fileSystem: {
          getMtimeByNormalPath: () => null,
          getDifference: (files) => files,
        },
      },
    });
    assert.equal(result.get("index.js")[4], 1);
  },
);

test(
  "Metro fallback also confirms Windows reparse file types",
  { skip: process.platform !== "win32" },
  (t) => {
    t.mock.method(fs, "readdirSync", () => [
      {
        name: "index.js",
        isDirectory: () => false,
        isSymbolicLink: () => true,
        isFile: () => false,
      },
    ]);
    const fallback = createFallback({
      rootPathUtils: {},
      extensions: ["js"],
      ignore: () => false,
      includeSymlinks: true,
    });
    assert.equal(fallback.readdir("", root, null).get("index.js")[4], 0);
  },
);

test(
  "Metro fallback preserves actual symbolic links",
  { skip: process.platform !== "win32" },
  (t) => {
    t.mock.method(fs, "readdirSync", () => [
      {
        name: "index.js",
        isDirectory: () => false,
        isSymbolicLink: () => true,
        isFile: () => false,
      },
    ]);
    t.mock.method(fs, "lstatSync", () => ({
      isDirectory: () => false,
      isSymbolicLink: () => true,
      isFile: () => false,
    }));
    const fallback = createFallback({
      rootPathUtils: {},
      extensions: ["js"],
      ignore: () => false,
      includeSymlinks: true,
    });
    assert.equal(fallback.readdir("", root, null).get("index.js")[4], 1);
  },
);

const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { dirname, join } = require("node:path");
const { test } = require("node:test");

const expoRequire = createRequire(require.resolve("expo/package.json"));
const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
const server = join(dirname(cliRequire.resolve("@expo/cli/package.json")), "build/src/start/server");
const { PluginSchema, DevToolsPluginOutputSchema } = require(join(server, "DevToolsPlugin.schema.js"));
const { createMCPDevToolsExtensionSchema } = require(join(server, "createMCPDevToolsExtensionSchema.js"));
const { DevToolsPluginCliExtensionResults } = require(join(server, "DevToolsPluginCliExtensionResults.js"));

// Expo에 실제 설치된 Zod와 소비 코드를 검사한다. 외부 서버·플러그인을 실행하지 않는다.
test("Expo CLI resolves the audited Zod release rather than vulnerable v3", () => {
  assert.equal(cliRequire("zod/package.json").version, "4.6.6");
});

const plugin = {
  packageName: "synthetic-test-plugin", packageRoot: __dirname,
  cliExtensions: {
    description: "Synthetic compatibility fixture", entryPoint: "unused.js",
    commands: [{ name: "inspect", title: "Inspect", environments: ["cli", "mcp"], parameters: [
      { name: "label", type: "text" }, { name: "limit", type: "number" }, { name: "enabled", type: "confirm" },
    ] }],
  },
};

test("Expo plugin descriptor still accepts valid fields and rejects invalid configuration", () => {
  assert.deepEqual(PluginSchema.parse(plugin), plugin);
  for (const invalid of [{}, { ...plugin, packageName: "" }, { ...plugin, cliExtensions: { ...plugin.cliExtensions, commands: [] } }]) {
    const result = PluginSchema.safeParse(invalid);
    assert.equal(result.success, false);
    assert.ok(result.error.issues.length > 0);
    assert.equal(typeof result.error.message, "string");
  }
});

test("Expo MCP schema preserves strict keys, typed parameters and optional fields", () => {
  const schema = createMCPDevToolsExtensionSchema(plugin);
  const valid = { command: "inspect", label: "local", limit: 2, enabled: true };
  assert.deepEqual(schema.parse(valid), valid);
  assert.deepEqual(schema.parse({ command: "inspect" }), { command: "inspect" });
  for (const invalid of [{ ...valid, extra: true }, { ...valid, command: "unknown" }, { ...valid, limit: "2" }, { ...valid, enabled: "true" }]) {
    assert.equal(schema.safeParse(invalid).success, false);
  }
  assert.throws(() => createMCPDevToolsExtensionSchema({ ...plugin, cliExtensions: undefined }), /no commands/);
});

test("Expo plugin output retains text/media parsing and invalid-output reporting", () => {
  const output = [{ type: "text", text: "done", level: "info" }, { type: "image", url: "https://example.invalid/image.png" }, { type: "audio", url: "https://example.invalid/audio.mp3" }];
  assert.deepEqual(DevToolsPluginOutputSchema.parse(output), output);
  const results = new DevToolsPluginCliExtensionResults();
  assert.deepEqual(results.parseOutputText(JSON.stringify(output)), output);
  assert.deepEqual(results.parseOutputText("plain text"), [{ type: "text", text: "plain text", level: "info" }]);
  for (const invalid of [[{ type: "image", url: "not-a-url" }], [{ type: "text", text: "oops", level: "unknown" }]]) {
    const [error] = results.parseOutputText(JSON.stringify(invalid));
    assert.equal(error.level, "error");
    assert.match(error.text, /^Invalid JSON:/);
  }
});

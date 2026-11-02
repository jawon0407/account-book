import assert from "node:assert/strict";
import { test } from "node:test";
import { isPrivateAcl } from "./private-directory.mjs";

const safe = { ownerMatches: true, protected: true, rules: [
  { principal: "user", allow: true, fullControl: true, inheritable: true },
  { principal: "system", allow: true, fullControl: true, inheritable: true },
] };

test("only a protected current-user-owned directory with inheritable user/SYSTEM grants can hold secrets", () => {
  assert.equal(isPrivateAcl(safe), true);
  for (const input of [
    undefined, {}, { ...safe, ownerMatches: false }, { ...safe, protected: false },
    { ...safe, rules: [...safe.rules, { principal: "other", allow: true, fullControl: true, inheritable: true }] },
    { ...safe, rules: [] },
    { ...safe, rules: safe.rules.map((r) => ({ ...r, inheritable: false })) },
    { ...safe, rules: safe.rules.map((r) => ({ ...r, fullControl: false })) },
    { ...safe, rules: safe.rules.map((r) => ({ ...r, allow: false })) },
  ]) assert.equal(isPrivateAcl(input), false);
});

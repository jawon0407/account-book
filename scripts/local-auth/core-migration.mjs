import { createHash } from "node:crypto";

/** @param {string[]} args CLI 인수. @returns {string} 허용 명령. 강제 적용/삭제 옵션은 없다. */
export function coreCommand(args) {
  if (args.length !== 1 || !["--inspect", "--check", "--apply"].includes(args[0])) throw new Error("CORE_ARGUMENTS_INVALID");
  return args[0];
}
/** @param {object} state 비밀값을 제외한 DB 사전 검사. @returns {void} 새 스키마 안전 조건을 만족하지 않으면 중단한다. */
export function assertCorePreflight(state) {
  if (state.currentUser !== "postgres" || state.database !== "postgres" || state.clientTls !== true || state.databaseTls !== true ||
    !Array.isArray(state.schemas) || state.schemas.length !== 0 || state.authReady !== true || state.privateTables !== 7 ||
    state.bootstrapExists !== false || state.rolesSafe !== true || state.rolesPresent !== true) throw new Error("CORE_PREFLIGHT_REFUSED");
}
/** @param {Record<string,boolean>} access 실제 PostgreSQL GRANT 조회 결과. @returns {void} 최소 열 권한과 금지 행위를 확인한다. */
export function assertCoreAccess(access) {
  const expected = { profileRead: true, nicknameUpdate: true, roleRead: true, providerUpdate: false, deletionUpdate: false, roleUpdate: false, auditRead: false, ledgerRead: true, ledgerDelete: false, transferUpdate: false };
  if (Object.entries(expected).some(([key,value])=>access[key]!==value)) throw new Error("CORE_RUNTIME_GRANTS_INVALID");
}
/** @param {string} sql 적용할 SQL 원문. @param {string} expected 검토한 SHA-256. @returns {string} 일치할 때만 원문 반환. */
export function checkedSql(sql, expected) {
  if (typeof sql !== "string" || !sql || createHash("sha256").update(sql).digest("hex") !== expected) throw new Error("CORE_SQL_CHECKSUM_MISMATCH");
  return sql;
}

export const coreMigrations = [
  ["202609290001_identity_storage.sql", "0c888dc9f519827f57c396ad8c8e3c8ac1858a56d6e37a4ffa20acc6ca444e8b"],
  ["202609290002_identity_access.sql", "634ca3676c383d295dd10ea9adbcb5e537ad7c5a54518b5b85f0352e368c7773"],
  ["202609290003_ledger_storage.sql", "389acbe9f22a3ee100ea6394c70a9fd8c4ef7abef64c4f9a323c83cf2382b38b"],
  ["202609290004_ledger_integrity.sql", "233da972d4dac5e6093b729a101644a6b211b9509a03b891826d070dec4bea6d"],
  ["202609290005_ledger_access.sql", "b68a9e72b268408198f4b0006f17155bb64a19e8866d192d7e520f599a88b268"],
];

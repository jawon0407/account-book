import { defineConfig } from "vitest/config";

// PostgreSQL 역할은 DB 사이에도 공유되므로 migration 테스트 파일을 동시에 실행하지 않는다.
export default defineConfig({ test: { fileParallelism: false, hookTimeout: 30_000 } });

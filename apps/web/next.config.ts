import type { NextConfig } from "next";
import { resolve } from "node:path";

/**
 * Next.js 설정을 읽을 때 운영 환경에 테스트 인증 어댑터가 들어오는지 검사한다.
 * NODE_ENV와 AUTH_ADAPTER_MODE 조합만 비교하며 비밀값을 보관하지 않는다.
 * @param environment - 서버 환경변수 모음. production과 fake가 동시에 지정되면 거부한다.
 * @returns 반환값 없음. 검사를 통과하면 설정 로딩을 계속한다.
 * @throws AUTH_CONFIGURATION_INVALID 운영 환경에서 fake를 선택하면 로딩을 중단한다.
 */
function assertProductionAuthAdapter(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (
    environment.NODE_ENV === "production" &&
    environment.AUTH_ADAPTER_MODE === "fake"
  ) {
    throw new Error("AUTH_CONFIGURATION_INVALID");
  }
}

assertProductionAuthAdapter(process.env);

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: { root: resolve(import.meta.dirname, "../..") },
};

export default config;

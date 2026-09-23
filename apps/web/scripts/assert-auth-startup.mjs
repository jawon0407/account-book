/**
 * 운영 서버 실행 전에 테스트 전용 fake 인증 설정을 거부한다.
 * 시작 스크립트에서 NODE_ENV와 AUTH_ADAPTER_MODE를 비교해 잘못된 조합을 차단한다.
 * @param {Readonly<Record<string, string | undefined>>} environment - 서버 환경변수. 비밀값을 읽거나 보관하지 않는다.
 * @returns {void} 반환값 없음. 통과하면 다음 서버 실행 명령을 진행한다.
 * @throws {Error} production과 fake 조합이면 AUTH_CONFIGURATION_INVALID로 실행을 중단한다.
 */
function assertProductionAuthAdapter(environment) {
  if (
    environment.NODE_ENV === "production" &&
    environment.AUTH_ADAPTER_MODE === "fake"
  ) {
    throw new Error("AUTH_CONFIGURATION_INVALID");
  }
}

assertProductionAuthAdapter(process.env);

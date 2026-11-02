/** 제공자와 앱 서버 사이에 허용하는 최대 시계 오차입니다. 토큰 만료 기한에는 더하지 않습니다. */
export const PROVIDER_CLOCK_SKEW_SECONDS = 60;

/**
 * 제공자 발급 초가 양의 안전한 정수이며 서버 시각보다 최대 60초만 앞서는지 검사합니다.
 * @param value 신뢰된 제공자 응답의 JWT 발급 초.
 * @param nowMilliseconds 제공자 호출 완료 후 앱 서버의 현재 밀리초.
 * @returns 발급 시각이 허용 범위이면 true. 원본 발급값은 보정하지 않습니다.
 */
export function validProviderIssuedAt(value: unknown, nowMilliseconds: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 &&
    Number.isFinite(nowMilliseconds) && value <= Math.floor(nowMilliseconds / 1000) + PROVIDER_CLOCK_SKEW_SECONDS;
}

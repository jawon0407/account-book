/** 서버가 선택하는 세션 채널. 요청의 임의 헤더를 그대로 넘기지 않는다. */
export type SessionChannel = "web" | "android";

/**
 * 웹에는 기기 ID가 없고 Android에는 설치별 UUID가 있어야 한다.
 * @param channel 저장되거나 서버 구성으로 선택된 채널.
 * @param deviceId 설치 구분 UUID 또는 웹의 null. 기기 소유/정식 앱 증명은 아니다.
 * @returns 모순 없는 문맥일 때만 true. 누락·미지원 채널은 거부한다.
 */
export function validSessionContext(channel: unknown, deviceId: unknown): boolean {
  if (channel === "web") return deviceId === null;
  return channel === "android" && typeof deviceId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(deviceId);
}

import "server-only";
import { OAuthAvailabilitySchema, type AuthProvider } from "@account-book/contracts";

/**
 * 서버 허용 목록을 읽는다. 미설정은 전부 비활성이며 잘못된 설정을 조용히 활성화하지 않는다.
 * @param environment 서버 환경변수. AUTH_ENABLED_PROVIDERS의 JSON 배열만 읽는다.
 * @returns 비밀값 없는 복사·동결된 공급자 목록.
 * @throws 값 자체를 노출하지 않는 AUTH_CONFIGURATION_INVALID.
 */
export function enabledOAuthProviders(environment: Readonly<Record<string, string | undefined>> = process.env): readonly AuthProvider[] {
  try {
    const parsed = OAuthAvailabilitySchema.parse({ enabledProviders: JSON.parse(environment.AUTH_ENABLED_PROVIDERS ?? "[]") });
    return Object.freeze([...parsed.enabledProviders]);
  } catch { throw new Error("AUTH_CONFIGURATION_INVALID"); }
}

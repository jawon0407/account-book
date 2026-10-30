import type { z } from "zod";
import {
  CollectorChangeInputSchema,
  CollectorStateSchema,
  NotificationConsentChangeInputSchema,
  NotificationConsentStateSchema,
  type CollectorChangeInput,
  type NotificationConsentChangeInput,
} from "@account-book/contracts";
import { ClientError } from "./client-error";

type CollectorRequest = <T>(
  path: string,
  method: "GET" | "PATCH",
  schema: z.ZodType<T>,
  token: string,
  body?: unknown,
) => Promise<T>;

/** 수집 기기 지정의 고정 HTTP 계약만 담당한다. 실제 알림 접근 권한을 요청하지 않는다. */
export class NativeCollectorClient {
  /** @param request NativeClient의 인증·timeout·응답 검증을 공유하는 전송 경계. */
  public constructor(private readonly request: CollectorRequest) {}

  /** @param token 현재 세션 토큰. 기기 식별자 없이 서버의 지정 상태만 읽는다. */
  public read(token: string) {
    return this.request("collector", "GET", CollectorStateSchema, token);
  }

  /** @param token 현재 세션. 회원·설치 식별은 서버에 맡기고 현재 고지의 동의 상태를 읽는다. */
  public readConsent(token: string) {
    return this.request(
      "collector/consent",
      "GET",
      NotificationConsentStateSchema,
      token,
    );
  }

  /** @param token 현재 세션. @param input 명시적으로 확인한 동의/철회와 마지막 조회 버전. 자동 재전송하지 않는다. */
  public async changeConsent(
    token: string,
    input: NotificationConsentChangeInput,
  ) {
    const parsed = NotificationConsentChangeInputSchema.safeParse(input);
    if (!parsed.success) throw new ClientError("COLLECTOR_VALIDATION_FAILED");
    return this.request(
      "collector/consent",
      "PATCH",
      NotificationConsentStateSchema,
      token,
      parsed.data,
    );
  }

  /** @param token 현재 세션. @param input 명시적 교체 결정과 마지막 조회 버전. 재전송하지 않는다. */
  public async change(token: string, input: CollectorChangeInput) {
    const parsed = CollectorChangeInputSchema.safeParse(input);
    if (!parsed.success) throw new ClientError("COLLECTOR_VALIDATION_FAILED");
    return this.request(
      "collector",
      "PATCH",
      CollectorStateSchema,
      token,
      parsed.data,
    );
  }
}

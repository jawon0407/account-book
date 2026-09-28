import { z } from "zod";

/** 내부 연결 요청 ID의 형식만 검사한다. 유효한 ID는 조회 권한을 뜻하지 않는다. */
export const BankConnectionRequestIdSchema = z.uuid();
export const BankConnectionStatusSchema = z.enum([
  "awaiting_callback", "awaiting_completion", "exchanging",
  "connected", "cancelled", "expired", "failed",
]);
/** 브라우저에 보낼 최소 상태. 알 수 없는 필드가 섞이면 전체 응답을 거부한다. */
export const BankConnectionRequestStatusSchema = z.strictObject({
  requestId: BankConnectionRequestIdSchema,
  status: BankConnectionStatusSchema,
});
export type BankConnectionRequestStatus =
  z.infer<typeof BankConnectionRequestStatusSchema>;

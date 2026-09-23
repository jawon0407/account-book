import { z } from "zod";

/**
 * 서버 UUID를 검증한 뒤 소문자로 통일한다. 소유권 검증은 인증된 사용자 기준으로 별도 수행한다.
 * 같은 UUID의 대소문자 차이를 없애 계좌/이체 ID 비교가 표기 차이에 영향을 받지 않게 한다.
 */
export const LedgerIdSchema = z.uuid().toLowerCase();
export type LedgerId = z.infer<typeof LedgerIdSchema>;

/**
 * 클라이언트의 한 생성 시도를 식별할 UUID v4 형식만 검사한다. 인증 정보가 아니다.
 * 재시도를 원래 결과에 연결하려면 향후 API가 사용자·작업·요청 내용 기준으로 별도 저장해야 한다.
 */
export const IdempotencyKeySchema = z.uuidv4();
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

/** 원화 금액을 1~MAX_SAFE_INTEGER의 정수로 제한한다. 음수·0·소수와 숫자 문자열을 거부한다. */
export const PositiveKrwAmountSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export type PositiveKrwAmount = z.infer<typeof PositiveKrwAmountSchema>;

/** 잔액의 음수·0·양수 표현을 허용하되 JavaScript가 정확히 표현할 수 있는 정수 범위만 인정한다. */
export const SignedKrwBalanceSchema = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export type SignedKrwBalance = z.infer<typeof SignedKrwBalanceSchema>;

/** 선택한 달력 날짜를 YYYY-MM-DD로 검사하며 시간대 변환은 하지 않는다. */
export const LocalDateSchema = z.iso.date();
export type LocalDate = z.infer<typeof LocalDateSchema>;

/** 오프셋을 포함할 수 있는 ISO 시각 문자열을 검사한다. UTC 변환이나 저장은 이 스키마의 역할이 아니다. */
export const TimestampSchema = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof TimestampSchema>;

/** 낙관적 동시성 제어에 사용할 양의 정수 버전 계약. 실제 저장 버전과의 비교는 향후 API가 담당한다. */
export const VersionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const ExpectedVersionSchema = VersionSchema;
export type Version = z.infer<typeof VersionSchema>;
export type ExpectedVersion = z.infer<typeof ExpectedVersionSchema>;

/** 클라이언트가 해석하지 않고 되돌려줄 커서의 문자와 길이만 검사한다. 발급·해독·진위 확인은 하지 않는다. */
export const CursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/u);
export type Cursor = z.infer<typeof CursorSchema>;

/** 목록 한 페이지의 요청 개수를 정수 1~100으로 제한한다. 생략 시 기본값은 이 스키마에 없다. */
export const PageSizeSchema = z.number().int().min(1).max(100);
export type PageSize = z.infer<typeof PageSizeSchema>;

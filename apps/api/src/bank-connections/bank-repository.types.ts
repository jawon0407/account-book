import type { BankConnectionRequestStatus } from "@account-book/contracts";
import type { BankTokenEnvelope } from "./security/token-envelope.js";
export type BankIdentity = Readonly<{ userId: string; sessionId: string }>;
export type BankEnvironment = "fake" | "test";
export type BankRequestContext = BankConnectionRequestStatus & Readonly<{ environment: BankEnvironment }>;
export type BankCredentials = Readonly<{
  connectionId: string; subject: BankTokenEnvelope; access: BankTokenEnvelope; refresh: BankTokenEnvelope | null;
  accessExpiresAt: Date; refreshExpiresAt: Date | null; consentExpiresAt: Date | null;
}>;

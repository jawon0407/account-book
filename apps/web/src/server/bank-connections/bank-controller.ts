import { BankConnectionRequestStatusSchema } from "@account-book/contracts";
import { boundedJson, coreJson, CoreBoundaryError } from "../core/http-boundary.js";
import type { CoreDependencies } from "../core/core-controller.js";
import { BankId, StartOutput, CompleteInput, EmptyInput, authorizationUrl, bankError, bankFailure, bankIdentity, bankUpstreamFailure, privateBankResponse } from "./bank-boundary.js";
import { createProof, proofCookie, proofDigest, readProof, clearProofCookie } from "./proof-cookie.js";

export type BankOperation = "start" | "complete" | "status";
type Dependencies = CoreDependencies & Readonly<{ authorizationEndpoint: string | null }>;

/** 은행 토큰에는 접근하지 않는다. 브라우저 확인 쿠키와 본인 세션을 검증해 API에 한 번 위임한다. */
export class BankController {
  /** @param dependencies 서버 인증·위임 의존성과 검증된 공급자 endpoint. null이면 시작 비활성. */
  public constructor(private readonly dependencies: Dependencies) {}
  /** @param operation 고정 작업. @param request 브라우저 요청. @param requestId status 경로의 UUID. */
  public async handle(operation: BankOperation, request: Request, requestId?: string): Promise<Response> {
    let consumed = false;
    try {
      const read = operation === "status";
      if (!["start", "complete", "status"].includes(operation)) return bankError("BANK_INVALID_REQUEST", 400);
      if (request.method !== (read ? "GET" : "POST")) return bankError("BANK_INVALID_REQUEST", 405);
      if (read && !BankId.safeParse(requestId).success) return bankError("BANK_INVALID_REQUEST", 400);
      const path = read ? `requests/${BankId.parse(requestId)}` : `kftc/${operation}`;
      const url = new URL(request.url);
      if (url.pathname !== `/api/bank-connections/${path}` || url.search) return bankError("BANK_INVALID_REQUEST", 400);
      const who = await bankIdentity(this.dependencies, request);
      let id = requestId, proof: string | undefined, payload: unknown;
      try {
        if (!read) {
          const body = await boundedJson(request, 1024);
          if (operation === "start") {
            EmptyInput.parse(body);
            if (this.dependencies.authorizationEndpoint === null) return bankError("BANK_UNAVAILABLE", 503);
            proof = createProof(); payload = { channel: "web", proofDigest: proofDigest(proof) };
          } else {
            id = CompleteInput.parse(body).requestId;
            payload = { requestId: id, proofDigest: readProof(request, id) };
          }
        }
      } catch (error) {
        if (error instanceof CoreBoundaryError) throw error;
        return bankError("BANK_INVALID_REQUEST", 400);
      }
      let response: Response;
      try {
        consumed = operation === "complete";
        const upstream = await this.dependencies.delegatedApiClient.request({ ...who, method: read ? "GET" : "POST", scope: read ? "bank-connection:read" : "bank-connection:write", target: `/v1/bank-connections/${path}`, contentType: read ? null : "application/json", body: read ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(payload)) });
        const raw = await boundedJson(upstream, 16_384);
        if (!upstream.ok) response = bankUpstreamFailure(raw, upstream.status);
        else {
          if (upstream.status !== 200) throw new Error("INVALID_BANK_STATUS");
          if (operation === "start") {
            const output = StartOutput.parse(raw);
            output.authorizationUrl = authorizationUrl(output.authorizationUrl, this.dependencies.authorizationEndpoint!);
            response = coreJson(output);
            response.headers.set("Set-Cookie", proofCookie(output.requestId, proof!));
          } else {
            const output = BankConnectionRequestStatusSchema.parse(raw);
            if (output.requestId !== id || (!read && output.status !== "connected")) throw new Error("INVALID_BANK_RESULT");
            response = coreJson(output);
          }
        }
      } catch { response = bankError("BANK_UNAVAILABLE", 502); }
      if (consumed) response.headers.set("Set-Cookie", clearProofCookie(id!));
      return privateBankResponse(response);
    } catch (error) { return bankFailure(error); }
  }
}

import { CollectorChangeInputSchema, type CollectorState } from "@account-book/contracts";
import { Controller, Get, Header, Inject, Patch, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequireDelegatedChannels, RequireDelegatedScope } from "../auth/delegated-scope.js";
import { CoreError } from "../core/core-error.js";
import { CollectorRepository } from "./collector.repository.js";

/** @param request 서명 검증된 요청. @returns 본문/쿼리가 아닌 인증된 사용자·세션 쌍. */
function identity(request: FastifyRequest) {
  if (!request.principal) throw new CoreError("AUTH_SESSION_EXPIRED", 401);
  if (!z.object({}).strict().safeParse(request.query).success) throw new CoreError("COLLECTOR_VALIDATION_FAILED", 400);
  return request.principal;
}

/** Android 전용 수집 설정. 상태 조회가 자동 기록 허가를 대체하지는 않는다. */
@Controller("v1/collector")
@UseGuards(AuthGuard)
@RequireDelegatedChannels("android")
export class CollectorController {
  /** @param repository 기존 DB lease 함수 저장소. */
  public constructor(@Inject(CollectorRepository) private readonly repository: CollectorRepository) {}
  /** @param request Android JWT 요청. @returns 공개 상태와 CAS 버전만. */
  @Get()
  @RequireDelegatedScope("collector:read")
  @Header("Cache-Control", "private, no-store")
  public get(@Req() request: FastifyRequest): Promise<CollectorState> {
    const principal = identity(request);
    return this.repository.get(principal.userId, principal.sessionId);
  }
  /** @param request 활성/해제·기대 버전·명시적 교체 선택. @returns 같은 DB transaction으로 변경한 상태. */
  @Patch()
  @RequireDelegatedScope("collector:write")
  @Header("Cache-Control", "private, no-store")
  public change(@Req() request: FastifyRequest): Promise<CollectorState> {
    const principal = identity(request), input = CollectorChangeInputSchema.safeParse(request.body);
    if (!input.success) throw new CoreError("COLLECTOR_VALIDATION_FAILED", 400);
    return this.repository.change(principal.userId, principal.sessionId, input.data);
  }
}

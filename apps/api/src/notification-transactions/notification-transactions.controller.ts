import {
  IdempotencyKeySchema,
  NotificationIngestionInputSchema,
  type NotificationReceipt,
} from "@account-book/contracts";
import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthGuard } from "../auth/auth.guard.js";
import {
  RequireDelegatedChannels,
  RequireDelegatedScope,
} from "../auth/delegated-scope.js";
import { CoreError } from "../core/core-error.js";
import { NotificationTransactionsRepository } from "./notification-transactions.repository.js";

/** @param request 검증된 요청. @returns 본문이 아닌 JWT의 회원/세션. 쿼리 입력은 허용하지 않는다. */
function identity(request: FastifyRequest) {
  if (!request.principal) throw new CoreError("AUTH_SESSION_EXPIRED", 401);
  if (!z.object({}).strict().safeParse(request.query).success)
    throw new CoreError("LEDGER_VALIDATION_FAILED", 400);
  return request.principal;
}

/** 서버 기반 전용 경로. 기본 provider는 비활성이며 BFF/모바일 업로드는 아직 연결하지 않는다. */
@Controller("v1/notification-transactions")
@UseGuards(AuthGuard)
@RequireDelegatedChannels("android")
export class NotificationTransactionsController {
  /** @param repository 동의/대표 기기 검증과 원자적 접수를 담당하는 저장소. */
  public constructor(
    @Inject(NotificationTransactionsRepository)
    private readonly repository: NotificationTransactionsRepository,
  ) {}

  /** @param request 최소 판독 입력. @returns 기존/신규 접수의 최소 결과. */
  @Post()
  @RequireDelegatedScope("notification:write")
  @Header("Cache-Control", "private, no-store")
  public create(@Req() request: FastifyRequest): Promise<NotificationReceipt> {
    const principal = identity(request),
      value = NotificationIngestionInputSchema.safeParse(request.body);
    if (!value.success) throw new CoreError("LEDGER_VALIDATION_FAILED", 400);
    return this.repository.create(
      principal.userId,
      principal.sessionId,
      value.data,
    );
  }

  /** @param request 인증 요청. @param eventId 접수 UUID. @returns 소유자 결과 또는 동일한 404. */
  @Get(":eventId")
  @RequireDelegatedScope("notification:read")
  @Header("Cache-Control", "private, no-store")
  public get(
    @Req() request: FastifyRequest,
    @Param("eventId") eventId: string,
  ): Promise<NotificationReceipt> {
    const principal = identity(request),
      key = IdempotencyKeySchema.safeParse(eventId);
    if (!key.success) throw new CoreError("LEDGER_VALIDATION_FAILED", 400);
    return this.repository.get(principal.userId, principal.sessionId, key.data);
  }
}

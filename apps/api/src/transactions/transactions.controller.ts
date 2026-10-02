import { Controller, Delete, Get, Header, Inject, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { CreateTransactionInputSchema, UpdateTransactionInputSchema, DeleteTransactionInputSchema, LedgerIdSchema, type Transaction, type TransactionListResponse } from "@account-book/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequireDelegatedScope } from "../auth/delegated-scope.js";
import { body, input, owner } from "../core/http-input.js";
import { parseTransactionQuery } from "./transaction-query.js";
import { TransactionsRepository } from "./transactions.repository.js";

/** 거래 전용 HTTP 경계. 브라우저가 보낸 소유자나 임의 scope는 허용하지 않는다. */
@Controller("v1/transactions")
@UseGuards(AuthGuard)
export class TransactionsController {
  /** @param repository 본인 거래 저장소. */
  public constructor(@Inject(TransactionsRepository) private readonly repository: TransactionsRepository) {}
  /** @param request 인증된 principal과 HTTP query. @returns 검증한 본인 거래 페이지. */
  @Get()
  @RequireDelegatedScope("transaction:read")
  @Header("Cache-Control", "private, no-store")
  public list(@Req() request: FastifyRequest): Promise<TransactionListResponse> {
    return this.repository.list(owner(request), parseTransactionQuery(request.query));
  }
  /** @param request 검증된 principal과 생성 JSON. @returns 멱등 생성 결과,201. */
  @Post()
  @RequireDelegatedScope("transaction:write")
  @Header("Cache-Control", "private, no-store")
  public create(@Req() request: FastifyRequest): Promise<Transaction> {
    return this.repository.create(owner(request), body(CreateTransactionInputSchema, request));
  }
  /** @param id 대상 UUID. @param request 변경값과 기대 버전. 소유자는 JWT에서만 가져온다. */
  @Patch(":id")
  @RequireDelegatedScope("transaction:write")
  @Header("Cache-Control", "private, no-store")
  public update(@Param("id") id: string, @Req() request: FastifyRequest): Promise<Transaction> {
    return this.repository.update(owner(request), input(LedgerIdSchema, id), body(UpdateTransactionInputSchema, request));
  }
  /** @param id 대상 UUID. @param request 기대 버전 JSON. @returns 삭제된 ID·버전·시간만 포함한 tombstone. */
  @Delete(":id")
  @RequireDelegatedScope("transaction:write")
  @Header("Cache-Control", "private, no-store")
  public remove(@Param("id") id: string, @Req() request: FastifyRequest) {
    return this.repository.remove(owner(request), input(LedgerIdSchema, id), body(DeleteTransactionInputSchema, request));
  }
}

import { CreateCategoryInputSchema, UpdateCategoryInputSchema, ArchiveCategoryInputSchema, LedgerIdSchema, type Category, type CategoryListResponse } from "@account-book/contracts";
import { Controller, Get, Header, HttpCode, Inject, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequireDelegatedScope } from "../auth/delegated-scope.js";
import { body, includeArchived, input, owner } from "../core/http-input.js";
import { CategoriesRepository } from "./categories.repository.js";

/** 카테고리 HTTP 경계. 입력 계약·요청 scope·소유권을 분리해 검사한다. */
@Controller("v1/categories")
@UseGuards(AuthGuard)
export class CategoriesController {
  /** @param repository 사용자별 최소 권한 저장소. */
  public constructor(@Inject(CategoriesRepository) private readonly repository: CategoriesRepository) {}
  /** @param request includeArchived query와 검증된 principal. @returns 본인 목록. */
  @Get()
  @RequireDelegatedScope("category:read")
  @Header("Cache-Control", "private, no-store")
  public list(@Req() request: FastifyRequest): Promise<CategoryListResponse> {
    return this.repository.list(owner(request), includeArchived(request));
  }
  /** @param request 생성 JSON/멱등성 키. @returns 최초 성공 결과, 201. */
  @Post()
  @RequireDelegatedScope("category:write")
  @Header("Cache-Control", "private, no-store")
  public create(@Req() request: FastifyRequest): Promise<Category> {
    return this.repository.create(owner(request), body(CreateCategoryInputSchema, request));
  }
  /** @param id 자원 UUID. @param request 변경 JSON/기대 버전. @returns 수정 후 자원. */
  @Patch(":id")
  @RequireDelegatedScope("category:write")
  @Header("Cache-Control", "private, no-store")
  public update(@Param("id") id: string, @Req() request: FastifyRequest): Promise<Category> {
    return this.repository.update(owner(request), input(LedgerIdSchema, id), body(UpdateCategoryInputSchema, request));
  }
  /** @param id 자원 UUID. @param request 기대 버전. @returns 기존 연결을 보존한 보관 자원. */
  @Post(":id/archive")
  @HttpCode(200)
  @RequireDelegatedScope("category:write")
  @Header("Cache-Control", "private, no-store")
  public archive(@Param("id") id: string, @Req() request: FastifyRequest): Promise<Category> {
    return this.repository.archive(owner(request), input(LedgerIdSchema, id), body(ArchiveCategoryInputSchema, request));
  }
}

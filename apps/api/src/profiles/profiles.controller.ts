import { UpdateProfileInputSchema, type Profile } from "@account-book/contracts";
import { Controller, Get, Header, Inject, Patch, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequireDelegatedScope } from "../auth/delegated-scope.js";
import { body, noQuery, owner } from "../core/http-input.js";
import { ProfilesRepository } from "./profiles.repository.js";

/** 사용자 입력이 아니라 검증된 principal로만 프로필에 접근한다. */
@Controller("v1/profile")
@UseGuards(AuthGuard)
export class ProfilesController {
  /** @param repository 최소 권한 프로필 저장소. */
  public constructor(@Inject(ProfilesRepository) private readonly repository: ProfilesRepository) {}
  /** @param request 서명 검증 완료 요청. @returns 본인 프로필, 캐시 금지. */
  @Get()
  @RequireDelegatedScope("profile:read")
  @Header("Cache-Control", "private, no-store")
  public get(@Req() request: FastifyRequest): Promise<Profile> {
    noQuery(request, true); return this.repository.get(owner(request));
  }
  /** @param request nickname/expectedVersion 본문. @returns 수정 후 프로필. */
  @Patch()
  @RequireDelegatedScope("profile:write")
  @Header("Cache-Control", "private, no-store")
  public update(@Req() request: FastifyRequest): Promise<Profile> {
    return this.repository.update(owner(request), body(UpdateProfileInputSchema, request, true));
  }
}

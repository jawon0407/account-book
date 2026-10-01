import { Module } from "@nestjs/common";
import type { Pool } from "pg";
import { MeModule, API_DATABASE_POOL } from "../me/me.module.js";
import { UserDatabase } from "./user-database.js";
import { ProfilesController } from "../profiles/profiles.controller.js";
import { ProfilesRepository } from "../profiles/profiles.repository.js";
import { AccountsController } from "../accounts/accounts.controller.js";
import { AccountsRepository } from "../accounts/accounts.repository.js";
import { CategoriesController } from "../categories/categories.controller.js";
import { CategoriesRepository } from "../categories/categories.repository.js";

/** 기존 인증 풀/가드를 재사용해 세 기능을 연결한다. 새 풀·고권한 계정·우회 인증은 만들지 않는다. */
@Module({
  imports: [MeModule],
  controllers: [ProfilesController, AccountsController, CategoriesController],
  providers: [
    { provide: UserDatabase, inject: [API_DATABASE_POOL],
      /** @param pool 프로세스 소유 공유 풀. @returns 요청별 transaction 실행기. */
      useFactory: (pool: Pool) => new UserDatabase(pool) },
    { provide: ProfilesRepository, inject: [UserDatabase],
      /** @param db 사용자 transaction 경계. @returns 프로필 저장소. */
      useFactory: (db: UserDatabase) => new ProfilesRepository(db) },
    { provide: AccountsRepository, inject: [UserDatabase],
      /** @param db 사용자 transaction 경계. @returns 계좌 저장소. */
      useFactory: (db: UserDatabase) => new AccountsRepository(db) },
    { provide: CategoriesRepository, inject: [UserDatabase],
      /** @param db 사용자 transaction 경계. @returns 분류 저장소. */
      useFactory: (db: UserDatabase) => new CategoriesRepository(db) },
  ],
})
export class CoreModule {}

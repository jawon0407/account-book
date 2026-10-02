import { Module } from "@nestjs/common";
import type { Pool } from "pg";
import { API_DATABASE_POOL, MeModule } from "../me/me.module.js";
import { BankController } from "./bank-controller.js";
import { BankCallbackController } from "./bank-callback.controller.js";
import { BankDatabase } from "./bank-database.js";
import { BankRepository } from "./bank-repository.js";
import { BANK_SERVICE } from "./bank.tokens.js";

/** 공식 adapter/키/프록시 검증 전에는 비활성. testing의 fake provider는 런타임에 import하지 않는다. */
@Module({
  imports: [MeModule], controllers: [BankController, BankCallbackController],
  providers: [
    { provide: BankDatabase, inject: [API_DATABASE_POOL],
      /** @param pool 기존 API 전용 풀. @returns 사용자/Callback transaction 경계. */
      useFactory: (pool: Pool) => new BankDatabase(pool) },
    { provide: BankRepository, inject: [BankDatabase],
      /** @param db 최소 권한 실행기. @returns 매개변수 SQL 저장소. */
      useFactory: (db: BankDatabase) => new BankRepository(db) },
    { provide: BANK_SERVICE, useValue: null },
  ],
})
export class BankModule {}

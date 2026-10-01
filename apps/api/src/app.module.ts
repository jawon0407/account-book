import { Controller, Get, Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ApiErrorFilter } from "./common/api-error.filter.js";
import { MeModule } from "./me/me.module.js";
import { CoreModule } from "./core/core.module.js";

@Controller("health")
class HealthController {
  /**
   * 프로세스가 요청을 처리할 수 있음을 알리는 공개 상태 확인 경로다. DB 연결은 검사하지 않는다.
   * @returns 항상 상태값 `ok`를 담은 객체.
   */
  @Get()
  public health(): Readonly<{ status: "ok" }> {
    return { status: "ok" };
  }
}

/** 공개 상태 확인, 보호된 사용자 조회, 내부 오류를 숨기는 공통 오류 필터를 연결한다. */
@Module({
  imports: [MeModule, CoreModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
})
export class AppModule {}

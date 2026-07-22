import { Controller, Get, Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ApiErrorFilter } from "./common/api-error.filter.js";
import { MeModule } from "./me/me.module.js";

@Controller("health")
class HealthController {
  @Get()
  public health(): Readonly<{ status: "ok" }> {
    return { status: "ok" };
  }
}

/** Minimal API composition with public health, protected identity, and one fail-closed error filter. */
@Module({
  imports: [MeModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
})
export class AppModule {}

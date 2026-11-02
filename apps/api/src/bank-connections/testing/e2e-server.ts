import "reflect-metadata";
import { randomBytes } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { assertBankE2e } from "./e2e-guard.js";

/** 폐기용 API 진입점. 일반 main.ts/BankModule에서는 이 파일을 import하지 않는다. */
async function start(): Promise<void> {
  // DB 풀·Nest module 로딩보다 먼저 고정 loopback/DB/인증 설정을 검사한다.
  assertBankE2e(process.env);
  const [{ Test }, { AppModule }, { BankRepository }, { BankConnectionService }, { BANK_SERVICE },
    { createApiFastifyAdapter }, { configureApiApplication, registerRequestBodyParsers }] = await Promise.all([
    import("@nestjs/testing"), import("../../app.module.js"), import("../bank-repository.js"),
    import("../bank-service.js"), import("../bank.tokens.js"), import("../../common/request-context.js"), import("../../main.js"),
  ]);
  const consumed = new Set<string>();
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(BANK_SERVICE).useFactory({
    inject: [BankRepository],
    /** @param repository 실제 최소 권한 DB 저장소. 공급자 호출만 합성한다. */
    factory: (repository: InstanceType<typeof BankRepository>) => new BankConnectionService(repository, {
      authorizationEndpoint: "https://bank.invalid/authorize",
      webResultUrl: "https://127.0.0.1:4512/app/bank-connections/result",
      callbackHmacKey: randomBytes(32),
      keys: { activeKid: "bank-e2e-only", keys: new Map([["bank-e2e-only", randomBytes(32)]]) },
      provider: {
        environment: "fake",
        /** @param state API가 생성한 state. 브라우저가 합성하는 예약 도메인 인가 화면으로 보낸다. */
        authorizationUrl: state => `https://bank.invalid/authorize?state=${encodeURIComponent(state)}`,
        /** @param code Callback 암호문에서 복호화한 합성 코드. 재교환·오류 코드는 거부한다. */
        exchange: async (code, signal) => {
          if (signal.aborted || consumed.has(code) || !code.startsWith("ok-")) throw new Error("FAKE_EXCHANGE_REJECTED");
          consumed.add(code);
          return { providerSubject: "synthetic-bank-subject", accessToken: "synthetic-bank-access-never-public",
            refreshToken: "synthetic-bank-refresh-never-public", accessExpiresAt: new Date(Date.now() + 3600_000),
            refreshExpiresAt: new Date(Date.now() + 7200_000), consentExpiresAt: null, permissions: ["accounts:read"] };
        },
      },
    }),
  }).compile();
  if (!(module.get(BANK_SERVICE) instanceof BankConnectionService)) throw new Error("E2E_PROVIDER_NOT_INJECTED");
  const app = module.createNestApplication<NestFastifyApplication>(createApiFastifyAdapter(), { logger: false });
  registerRequestBodyParsers(app); await configureApiApplication(app); app.enableShutdownHooks();
  await app.listen(4511, "127.0.0.1");
}
// 에러 객체에는 연결 문자열이 포함될 수 있으므로 세부 오류를 출력하지 않는다.
void start().catch(() => { process.stderr.write("BANK_E2E_START_FAILED\n"); process.exitCode = 1; });

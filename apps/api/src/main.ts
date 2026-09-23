import "reflect-metadata";
import { parse as parseUrlencoded } from "node:querystring";
import { pathToFileURL } from "node:url";
import helmet from "@fastify/helmet";
import { NestFactory } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import {
  createApiFastifyAdapter,
  registerRequestContext,
} from "./common/request-context.js";
import { registerRawJsonBody } from "./auth/raw-json-body.js";
import { getApiEnvironment } from "./environment.js";

/**
 * 응답 추적 ID 훅과 Helmet의 보안 헤더 플러그인을 등록한다.
 * @param app - 서버가 요청 ID를 생성하는 어댑터로 만든 Nest 애플리케이션.
 * @returns 보안 플러그인 등록이 끝나면 완료되는 Promise.
 * @throws 등록 실패는 호출자에게 전달되어 서버 시작을 중단한다.
 */
export async function configureApiApplication(app: NestFastifyApplication): Promise<void> {
  registerRequestContext(app.getHttpAdapter().getInstance());
  await app.register(helmet);
}

/**
 * 경로 초기화 전에 JSON 원문 보존 파서와 URL 인코딩 폼 파서를 등록한다.
 * @param app - 파서를 소유한 Fastify 어댑터가 연결된 Nest 애플리케이션.
 * @returns 반환값 없음. 애플리케이션의 본문 파서 구성을 변경한다.
 */
export function registerRequestBodyParsers(app: NestFastifyApplication): void {
  // Nest가 경로를 초기화하기 전에 Nest 소유 Fastify 인스턴스에 파서를 설치한다.
  registerRawJsonBody(app.getHttpAdapter().getInstance());
  // JSON은 전용 파서에 맡기고 기존 URL 인코딩 폼 본문 지원은 유지한다.
  // 콜백은 요청 문맥을 쓰지 않고 body를 UTF-8로 읽어 done에 폼 필드 객체를 넘긴다.
  app.useBodyParser("application/x-www-form-urlencoded", {}, (_request, body, done) => {
    done(null, parseUrlencoded(body.toString("utf8")));
  });
}

/**
 * 환경 변수를 읽고 API 구성, 파서, 보안 헤더, 종료 훅을 준비한 뒤 HTTP 포트를 연다.
 * @returns 서버의 listen이 완료되면 이행되는 Promise.
 * @throws 잘못된 설정이나 플러그인·서버 시작 실패. 직접 실행한 경우 종료 코드 1로 처리된다.
 */
async function bootstrap(): Promise<void> {
  const environment = getApiEnvironment();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createApiFastifyAdapter(),
    { logger: false },
  );
  registerRequestBodyParsers(app);
  await configureApiApplication(app);
  app.enableShutdownHooks();
  await app.listen(environment.apiPort, environment.apiHost);
}

const executable = process.argv[1];
if (executable !== undefined && import.meta.url === pathToFileURL(executable).href) {
  // 직접 실행한 서버의 시작 실패는 상세 오류를 출력하지 않고 종료 코드만 1로 표시한다.
  void bootstrap().catch(() => {
    process.exitCode = 1;
  });
}

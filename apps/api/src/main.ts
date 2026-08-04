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
 * Installs response request IDs and Helmet on a Nest Fastify application.
 * @param app - Application created with the server-owned request-ID adapter.
 * @returns A promise fulfilled after security plugins are registered before request handling.
 * @throws Plugin registration failures; startup fails closed without enabling CORS or a fallback path.
 */
export async function configureApiApplication(app: NestFastifyApplication): Promise<void> {
  registerRequestContext(app.getHttpAdapter().getInstance());
  await app.register(helmet);
}

/**
 * Registers the request parsers required before Nest initializes application routes.
 * @param app - Nest application whose Fastify adapter owns the parsers.
 */
export function registerRequestBodyParsers(app: NestFastifyApplication): void {
  // This is the Fastify instance owned by Nest, registered before route initialization.
  registerRawJsonBody(app.getHttpAdapter().getInstance());
  // Preserve Nest Fastify's existing form parser while keeping JSON exclusively custom.
  app.useBodyParser("application/x-www-form-urlencoded", {}, (_request, body, done) => {
    done(null, parseUrlencoded(body.toString("utf8")));
  });
}

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
  void bootstrap().catch(() => {
    process.exitCode = 1;
  });
}

import "reflect-metadata";
import { pathToFileURL } from "node:url";
import helmet from "@fastify/helmet";
import { NestFactory } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import {
  createApiFastifyAdapter,
  registerRequestContext,
} from "./common/request-context.js";
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

async function bootstrap(): Promise<void> {
  const environment = getApiEnvironment();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createApiFastifyAdapter(),
    { logger: false },
  );
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

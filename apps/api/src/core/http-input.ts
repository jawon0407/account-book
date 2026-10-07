import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { CoreError } from "./core-error.js";
import { input } from "./validation.js";
export { input } from "./validation.js";

/** @param request 가드가 검증한 요청. @returns 서명된 본인 UUID. 클라이언트 입력의 userId는 쓰지 않는다. */
export function owner(request: FastifyRequest): string {
  if (!request.principal) throw new CoreError("AUTH_SESSION_EXPIRED", 401);
  return request.principal.userId;
}
const EmptyQuery = z.object({}).strict();
const ListQuery = z.object({ includeArchived: z.enum(["true", "false"]).optional() }).strict();
/** @param request GET 요청. @returns 정확한 true만 true이며 중복/배열/추가 query는 400. */
export function includeArchived(request: FastifyRequest): boolean { return input(ListQuery, request.query).includeArchived === "true"; }
/** @param request query가 허용되지 않는 요청. @param profile 오류 구분. @returns 없음; 추가 query면400. */
export function noQuery(request: FastifyRequest, profile = false): void { input(EmptyQuery, request.query, profile); }
/** @param schema 본문 계약. @param request 변경 요청. @param profile 오류 구분. @returns query 없는 JSON 본문. */
export function body<T>(schema: z.ZodType<T>, request: FastifyRequest, profile = false): T {
  noQuery(request, profile); return input(schema, request.body, profile);
}

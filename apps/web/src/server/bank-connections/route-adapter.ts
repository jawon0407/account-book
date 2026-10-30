import "server-only";
import { createRequestContainer } from "../container.js";
import { bankError } from "./bank-boundary.js";
import type { BankController, BankOperation } from "./bank-controller.js";

type Context = Readonly<{ params?: Promise<{ requestId: string }> }>;
/** @param operation 서버 고정 작업. @param request 웹 요청. @param context Next 비동기 params. @param factory 요청 전용 컨테이너. */
export async function handleBankRoute(operation: BankOperation, request: Request, context: Context = {}, factory: () => { bankController: Pick<BankController, "handle"> } = createRequestContainer): Promise<Response> {
  try { return await factory().bankController.handle(operation, request, (await context.params)?.requestId); }
  catch { return bankError("BANK_UNAVAILABLE", 503); }
}
/** 미지원 메서드는 세션/DB/컨테이너를 만들지 않는다. */
export const unsupportedBankRoute = () => bankError("BANK_INVALID_REQUEST", 405);

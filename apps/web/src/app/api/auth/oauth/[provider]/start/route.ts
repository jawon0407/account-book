import { handleAuthRoute } from "../../../../../../server/http/route-adapter.js";
export { unsupportedAuthRoute as GET, unsupportedAuthRoute as PUT, unsupportedAuthRoute as PATCH, unsupportedAuthRoute as DELETE, unsupportedAuthRoute as HEAD, unsupportedAuthRoute as OPTIONS } from "../../../../../../server/http/route-adapter.js";

type Context = Readonly<{ params: Promise<Readonly<{ provider: string }>> }>;
export const POST = (request: Request, context: Context) => handleAuthRoute("oauthStart", request, context);

import { handleAuthRoute } from "../../../../server/http/route-adapter.js";
export { unsupportedAuthRoute as GET, unsupportedAuthRoute as PUT, unsupportedAuthRoute as PATCH, unsupportedAuthRoute as DELETE, unsupportedAuthRoute as HEAD, unsupportedAuthRoute as OPTIONS } from "../../../../server/http/route-adapter.js";

export const POST = (request: Request) => handleAuthRoute("signIn", request);

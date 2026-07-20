import { handleAuthRoute } from "../../../../../server/http/route-adapter.js";
export { unsupportedAuthRoute as POST, unsupportedAuthRoute as PUT, unsupportedAuthRoute as PATCH, unsupportedAuthRoute as DELETE, unsupportedAuthRoute as HEAD, unsupportedAuthRoute as OPTIONS } from "../../../../../server/http/route-adapter.js";

export const GET = (request: Request) => handleAuthRoute("emailCallback", request);

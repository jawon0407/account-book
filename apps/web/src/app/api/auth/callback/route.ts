import { handleAuthRoute } from "../../../../server/http/route-adapter.js";

export const GET = (request: Request) => handleAuthRoute("oauthCallback", request);

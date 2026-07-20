import { handleAuthRoute } from "../../../../server/http/route-adapter.js";

export const POST = (request: Request) => handleAuthRoute("signUp", request);

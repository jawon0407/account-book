import { handleAuthRoute } from "../../../../server/http/route-adapter.js";

export const GET = (request: Request) => handleAuthRoute("session", request);

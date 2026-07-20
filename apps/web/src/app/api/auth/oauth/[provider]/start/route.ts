import { handleAuthRoute } from "../../../../../../server/http/route-adapter.js";

type Context = Readonly<{ params: Promise<Readonly<{ provider: string }>> }>;
export const POST = (request: Request, context: Context) => handleAuthRoute("oauthStart", request, context);

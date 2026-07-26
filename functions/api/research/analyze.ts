import { handleEquityResearchRequest } from "../../../src/server/equityResearchService.js";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  return handleEquityResearchRequest(context.request, {
    apiToken: context.env.EODHD_API_TOKEN,
    cache: caches.default,
    waitUntil: (promise: Promise<unknown>) => context.waitUntil(promise),
  });
};

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "POST") {
    return onRequestPost(context);
  }

  return Response.json(
    {
      error: {
        code: "method_not_allowed",
        message: "Method not allowed.",
      },
    },
    {
      status: 405,
      headers: {
        Allow: "POST",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
};

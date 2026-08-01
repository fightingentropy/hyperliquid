import { handleEquityResearchRequest } from "../../../src/server/equityResearchService.js";
import {
  AccessAuthenticationError,
  verifyCloudflareAccessRequest,
} from "../../../src/server/cloudflareAccess.js";
import { createD1ResearchControl } from "../../../src/server/researchControl.js";
import { EquityResearchError } from "../../../src/lib/equityResearch.js";

type ResearchEnv = Env & {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  RESEARCH_ALLOW_LOCAL_DEV?: string;
  RESEARCH_USER_DAILY_LIMIT?: string;
  RESEARCH_IP_DAILY_LIMIT?: string;
  RESEARCH_PROVIDER_DAILY_BUDGET?: string;
  RESEARCH_CONTROL_DB?: D1Database;
};

export const onRequestPost: PagesFunction<ResearchEnv> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const localDev =
      context.env.RESEARCH_ALLOW_LOCAL_DEV === "true" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    const identity = localDev
      ? { id: "local-development", email: null }
      : await verifyCloudflareAccessRequest(context.request, {
          teamDomain: context.env.CF_ACCESS_TEAM_DOMAIN,
          audience: context.env.CF_ACCESS_AUD,
        });
    const control = createD1ResearchControl(context.env.RESEARCH_CONTROL_DB, {
      userRequestsPerDay: context.env.RESEARCH_USER_DAILY_LIMIT,
      ipRequestsPerDay: context.env.RESEARCH_IP_DAILY_LIMIT,
      providerCallsPerDay: context.env.RESEARCH_PROVIDER_DAILY_BUDGET,
    });
    await control.admitRequest({
      principal: identity.id,
      ip: context.request.headers.get("CF-Connecting-IP"),
    });

    const defaultCache = (caches as unknown as { default: Cache }).default;
    return handleEquityResearchRequest(context.request, {
      apiToken: context.env.EODHD_API_TOKEN,
      cache: defaultCache,
      waitUntil: (promise: Promise<unknown>) => context.waitUntil(promise),
      principal: identity.id,
      providerControl: control.providerControl,
    });
  } catch (error) {
    if (error instanceof AccessAuthenticationError || error instanceof EquityResearchError) {
      return errorResponse(error.code, error.message, error.status);
    }
    console.error(JSON.stringify({ message: "research admission failed" }));
    return errorResponse(
      "research_control_unavailable",
      "Research access controls are unavailable.",
      503,
    );
  }
};

export const onRequest: PagesFunction<ResearchEnv> = async (context) => {
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

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

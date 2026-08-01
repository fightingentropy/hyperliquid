import { createRemoteJWKSet, jwtVerify } from "jose";

const jwksByDomain = new Map();

export class AccessAuthenticationError extends Error {
  constructor(message, { code = "access_denied", status = 403 } = {}) {
    super(message);
    this.name = "AccessAuthenticationError";
    this.code = code;
    this.status = status;
  }
}

/**
 * @param {Request} request
 * @param {any} options
 */
export async function verifyCloudflareAccessRequest(
  request,
  {
    teamDomain,
    audience,
    jwtVerifyImpl = jwtVerify,
    createRemoteJWKSetImpl = createRemoteJWKSet,
  } = {},
) {
  const issuer = normalizeTeamDomain(teamDomain);
  const expectedAudience = String(audience ?? "").trim();
  if (!issuer || !expectedAudience) {
    throw new AccessAuthenticationError("Cloudflare Access is not configured.", {
      code: "access_not_configured",
      status: 503,
    });
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    throw new AccessAuthenticationError("A valid Cloudflare Access session is required.", {
      code: "authentication_required",
      status: 401,
    });
  }

  try {
    let jwks = jwksByDomain.get(issuer);
    if (!jwks) {
      jwks = createRemoteJWKSetImpl(new URL(`${issuer}/cdn-cgi/access/certs`));
      jwksByDomain.set(issuer, jwks);
    }
    const { payload } = await jwtVerifyImpl(token, jwks, {
      issuer,
      audience: expectedAudience,
      algorithms: ["RS256"],
    });
    const subject = String(payload.sub ?? "").trim();
    const email = String(payload.email ?? "").trim().toLowerCase();
    if (!subject && !email) throw new Error("missing stable identity");
    return {
      id: subject || email,
      email: email || null,
    };
  } catch (error) {
    if (error instanceof AccessAuthenticationError) throw error;
    throw new AccessAuthenticationError("The Cloudflare Access session is invalid.");
  }
}

function normalizeTeamDomain(value) {
  try {
    const url = new URL(String(value ?? ""));
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".cloudflareaccess.com") ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

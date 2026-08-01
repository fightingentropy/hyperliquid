import { describe, expect, it, vi } from "vitest";
import {
  AccessAuthenticationError,
  verifyCloudflareAccessRequest,
} from "./cloudflareAccess";

function accessRequest(token = null) {
  return new Request("https://example.com/api/research/analyze", {
    headers: token ? { "Cf-Access-Jwt-Assertion": token } : {},
  });
}

describe("Cloudflare Access validation", () => {
  it("fails closed when Access configuration or its assertion is missing", async () => {
    await expect(verifyCloudflareAccessRequest(accessRequest(), {}))
      .rejects.toMatchObject({ code: "access_not_configured", status: 503 });
    await expect(verifyCloudflareAccessRequest(accessRequest(), {
      teamDomain: "https://team.cloudflareaccess.com",
      audience: "audience",
    })).rejects.toMatchObject({ code: "authentication_required", status: 401 });
  });

  it("verifies RS256 issuer and audience before returning a stable identity", async () => {
    const jwtVerifyImpl = vi.fn(async () => ({ payload: { sub: "user-123", email: "USER@example.com" } }));
    const createRemoteJWKSetImpl = vi.fn(() => "jwks");
    const identity = await verifyCloudflareAccessRequest(accessRequest("signed-token"), {
      teamDomain: "https://unit-test.cloudflareaccess.com",
      audience: "research-aud",
      jwtVerifyImpl,
      createRemoteJWKSetImpl,
    });

    expect(identity).toEqual({ id: "user-123", email: "user@example.com" });
    expect(jwtVerifyImpl).toHaveBeenCalledWith("signed-token", "jwks", {
      issuer: "https://unit-test.cloudflareaccess.com",
      audience: "research-aud",
      algorithms: ["RS256"],
    });
  });

  it("rejects unsafe team domains and redacts verifier failures", async () => {
    await expect(verifyCloudflareAccessRequest(accessRequest("token"), {
      teamDomain: "https://attacker.example",
      audience: "audience",
    })).rejects.toBeInstanceOf(AccessAuthenticationError);

    await expect(verifyCloudflareAccessRequest(accessRequest("token"), {
      teamDomain: "https://bad-token.cloudflareaccess.com",
      audience: "audience",
      createRemoteJWKSetImpl: () => "jwks",
      jwtVerifyImpl: async () => { throw new Error("raw cryptographic detail"); },
    })).rejects.toMatchObject({ message: "The Cloudflare Access session is invalid." });
  });
});

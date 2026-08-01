import { describe, expect, it } from "vitest";
import { createD1ResearchControl } from "./researchControl";

class FakeD1 {
  constructor() {
    this.days = new Map();
    this.circuit = { failures: 0, opened_until: 0 };
  }

  prepare(sql) {
    return {
      bind: (...args) => ({
        run: async () => this.run(sql, args),
        first: async () => this.first(sql, args),
      }),
    };
  }

  run(sql, args) {
    if (sql.includes("INSERT OR IGNORE INTO research_daily_usage")) {
      if (!this.days.has(args[0])) {
        this.days.set(args[0], { provider_calls: 0, users: new Map(), ips: new Map() });
      }
    } else if (sql.includes("research_provider_circuit") && sql.includes("failures + 1")) {
      this.circuit.failures += 1;
      if (this.circuit.failures >= args[1]) this.circuit.opened_until = args[2];
    } else if (sql.includes("research_provider_circuit")) {
      this.circuit = { failures: 0, opened_until: 0 };
    }
    return { success: true };
  }

  first(sql, args) {
    if (sql.includes("SELECT failures")) return { ...this.circuit };
    if (sql.includes("SET provider_calls")) {
      const row = this.days.get(args[0]);
      if (row.provider_calls >= args[1]) return null;
      row.provider_calls += 1;
      return { provider_calls: row.provider_calls };
    }
    if (sql.includes("SET user_counts")) {
      const row = this.days.get(args[4]);
      const user = args[0];
      const ip = args[2];
      const userCount = row.users.get(user) ?? 0;
      const ipCount = row.ips.get(ip) ?? 0;
      if (userCount >= args[6] || ipCount >= args[8]) return null;
      row.users.set(user, userCount + 1);
      row.ips.set(ip, ipCount + 1);
      return { provider_calls: row.provider_calls };
    }
    return null;
  }
}

describe("D1 research controls", () => {
  it("atomically enforces user, IP, and actual provider-call budgets", async () => {
    const db = new FakeD1();
    const control = createD1ResearchControl(db, {
      userRequestsPerDay: 1,
      ipRequestsPerDay: 2,
      providerCallsPerDay: 2,
      now: () => Date.parse("2026-08-01T12:00:00Z"),
    });

    await control.admitRequest({ principal: "one", ip: "203.0.113.1" });
    await expect(control.admitRequest({ principal: "one", ip: "203.0.113.1" }))
      .rejects.toMatchObject({ code: "research_quota_exhausted", status: 429 });
    await control.providerControl.beforeCall();
    await control.providerControl.beforeCall();
    await expect(control.providerControl.beforeCall())
      .rejects.toMatchObject({ code: "provider_budget_exhausted", status: 429 });
  });

  it("opens after repeated failures and resets after a successful probe", async () => {
    let timestamp = Date.parse("2026-08-01T12:00:00Z");
    const control = createD1ResearchControl(new FakeD1(), {
      providerCallsPerDay: 20,
      now: () => timestamp,
    });

    await control.providerControl.failure();
    await control.providerControl.failure();
    await control.providerControl.failure();
    await expect(control.providerControl.beforeCall())
      .rejects.toMatchObject({ code: "provider_circuit_open", status: 503 });

    timestamp += 60_001;
    await control.providerControl.beforeCall();
    await control.providerControl.success();
    await control.providerControl.beforeCall();
  });
});

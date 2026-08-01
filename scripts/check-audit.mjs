import { spawnSync } from "node:child_process";

const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error("npm audit did not return valid JSON");
  process.exit(1);
}

const allowedPackages = new Set(["react-router", "react-router-dom"]);
const allowedAdvisory = "https://github.com/advisories/GHSA-qwww-vcr4-c8h2";
const vulnerabilities = Object.values(report.vulnerabilities ?? {});
const disallowed = vulnerabilities.filter((item) => {
  if (!["high", "critical"].includes(item.severity)) return false;
  if (!allowedPackages.has(item.name)) return true;
  return item.via.some((entry) => typeof entry === "object" && entry.url !== allowedAdvisory);
});

if (disallowed.length) {
  console.error(`Unallowlisted production audit findings: ${disallowed.map((item) => item.name).join(", ")}`);
  process.exit(1);
}

if (vulnerabilities.length) {
  // GHSA-qwww-vcr4-c8h2 affects only unstable React Server Components. This is
  // a client-only Vite SPA and does not import an RSC router. Remove this exact
  // allowance as soon as a compatible patched react-router-dom is published.
  console.warn("Allowed GHSA-qwww-vcr4-c8h2: hl-stats does not use React Server Components.");
}

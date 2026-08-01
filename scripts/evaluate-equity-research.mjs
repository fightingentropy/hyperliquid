import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateWalkForward } from "../src/lib/equityResearchWalkForward.js";

const inputArgument = process.argv[2];
const outputArgument = process.argv[3];

if (!inputArgument || inputArgument.startsWith("-")) {
  console.error("Usage: npm run research:validate -- <point-in-time-input.json> [report.json]");
  process.exitCode = 2;
} else {
  try {
    const inputPath = resolve(inputArgument);
    const payload = JSON.parse(await readFile(inputPath, "utf8"));
    const report = evaluateWalkForward(payload);
    const serialized = `${JSON.stringify(report, null, 2)}\n`;

    if (outputArgument) {
      const outputPath = resolve(outputArgument);
      await writeFile(outputPath, serialized, { encoding: "utf8", mode: 0o600 });
      console.log(`Walk-forward report written to ${outputPath}`);
    } else {
      process.stdout.write(serialized);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

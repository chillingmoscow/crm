// Read-only comparison of complete, independently verified source manifests.
// The output is a proposal; it cannot post, import or link a financial operation.
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--input" || args[2] !== "--output")
  throw Error(
    "Укажите --input PRIVATE_INPUT.json --output PRIVATE_REPORT.json",
  );
const dir = await mkdtemp(join(tmpdir(), "supply-payment-comparison-"));
try {
  const input = JSON.parse(await readFile(resolve(args[1]), "utf8"));
  const filepath = new URL("../src/lib/supplies/payments.ts", import.meta.url);
  const code = ts
    .transpileModule(await readFile(filepath, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(
      /from ["']zod["']/g,
      `from ${JSON.stringify(import.meta.resolve("zod"))}`,
    );
  await writeFile(join(dir, "payments.mjs"), code);
  const { compareSupplyExpenses } = await import(
    pathToFileURL(join(dir, "payments.mjs"))
  );
  const report = compareSupplyExpenses(input);
  await writeFile(resolve(args[3]), JSON.stringify(report, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      ...report.counts,
      amountCents: report.source.amountCents,
      confirmedLinks: report.confirmedLinks,
    }),
  );
} finally {
  await rm(dir, { force: true, recursive: true });
}

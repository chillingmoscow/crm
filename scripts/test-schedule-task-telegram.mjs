import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const dir = await mkdtemp(join(tmpdir(), "task-telegram-"));
try {
  const file = join(dir, "response.mjs");
  await writeFile(
    file,
    ts.transpileModule(
      await readFile("src/lib/integrations/telegram-response.ts", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
  );
  const { readTelegramResponse, telegramMessageReceipt } = await import(
    pathToFileURL(file)
  );
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status });
  const fixtures = [
    [
      json({ ok: true, result: { message_id: 123 } }),
      { messageId: 123, uncertain: false },
    ],
    [
      json(
        { ok: false, error_code: 429, description: "Too Many Requests" },
        429,
      ),
      { messageId: null, uncertain: false },
    ],
    [
      new Response("<html>bad gateway</html>", { status: 502 }),
      { messageId: null, uncertain: true },
    ],
    [
      new Response("truncated", { status: 200 }),
      { messageId: null, uncertain: true },
    ],
    [json({ ok: true, result: {} }), { messageId: null, uncertain: true }],
    [
      json({ ok: true, result: { message_id: -1 } }),
      { messageId: null, uncertain: true },
    ],
    [
      json({
        ok: false,
        result: { message_id: 123 },
        error_code: 500,
        description: "contradiction",
      }),
      { messageId: null, uncertain: true },
    ],
    [
      json({ ok: true, result: { message_id: 123 } }, 502),
      { messageId: null, uncertain: true },
    ],
    [json({ ok: false }), { messageId: null, uncertain: true }],
  ];
  for (const [response, expected] of fixtures)
    assert.deepEqual(
      telegramMessageReceipt(await readTelegramResponse(response)),
      expected,
    );
  console.log(
    "PASS: confirmed delivery, explicit rejection and malformed/contradictory Telegram responses",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}

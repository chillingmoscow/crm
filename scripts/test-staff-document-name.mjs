import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/lib/people/staff-document-name.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { encodeStaffDocumentName, decodeStaffDocumentName } = await import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'));
for (const label of ['Паспорт — разворот 1', 'Фото / документ №2: 100%_готово', 'Обследование 🗂']) {
  const key = encodeStaffDocumentName(label);
  assert.match(key, /^hex-[a-f0-9]+$/);
  assert.equal(decodeStaffDocumentName(key), label);
  assert.ok(!key.includes('__'));
}
assert.equal(decodeStaffDocumentName(encodeURIComponent('Прежний документ')), 'Прежний документ');
assert.throws(() => decodeStaffDocumentName('hex-ff'));
console.log('PASS: Russian storage labels, reserved path characters, legacy labels and invalid UTF-8');

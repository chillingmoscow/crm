import { test } from "node:test";
import assert from "node:assert/strict";
import { renameFileName, filePreviewKind, fileKindLabel, formatFileSize } from "./file-name.ts";

test("renameFileName дописывает исходное расширение", () => {
  assert.deepEqual(renameFileName("scan.pdf", "Договор поставки"), { name: "Договор поставки.pdf", error: null });
});
test("renameFileName не дублирует расширение (регистр не важен)", () => {
  assert.deepEqual(renameFileName("scan.PDF", "Договор.pdf"), { name: "Договор.pdf", error: null });
});
test("renameFileName обрезает и схлопывает пробелы", () => {
  assert.deepEqual(renameFileName("a.jpg", "  Фото   склада "), { name: "Фото склада.jpg", error: null });
});
test("renameFileName без расширения у исходного", () => {
  assert.deepEqual(renameFileName("README", "Описание"), { name: "Описание", error: null });
});
test("renameFileName отказывает на пустом", () => {
  assert.deepEqual(renameFileName("a.pdf", "   "), { name: null, error: "Укажите название файла" });
});
test("renameFileName отказывает на слэшах", () => {
  assert.deepEqual(renameFileName("a.pdf", "ООО/ИП"), { name: null, error: "Название не может содержать / и \\" });
});
test("renameFileName отказывает длиннее 200 символов (с расширением)", () => {
  assert.deepEqual(renameFileName("a.pdf", "я".repeat(197)), { name: null, error: "Название длиннее 200 символов" });
});
test("filePreviewKind", () => {
  assert.equal(filePreviewKind("application/pdf"), "pdf");
  // Вид — только по сохранённому типу: имя «.pdf» у HTML не делает его PDF.
  assert.equal(filePreviewKind("application/octet-stream"), "none");
  assert.equal(filePreviewKind("text/html"), "none");
  assert.equal(filePreviewKind("image/jpeg"), "image");
  assert.equal(filePreviewKind("image/png"), "image");
  assert.equal(filePreviewKind("image/webp"), "image");
  assert.equal(filePreviewKind("image/heic"), "none");
  assert.equal(filePreviewKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "none");
});
test("fileKindLabel и formatFileSize как раньше в transaction-files", () => {
  assert.equal(fileKindLabel("image/png", "x.png"), "Фото");
  assert.equal(fileKindLabel("application/pdf", "x.pdf"), "PDF");
  assert.equal(fileKindLabel("", "x.docx"), "DOCX");
  assert.equal(formatFileSize(512), "512 Б");
  assert.equal(formatFileSize(157_286), "154 КБ");
  assert.equal(formatFileSize(5 * 1024 * 1024), "5,0 МБ");
});
test("renameFileName отказывает на управляющих и невидимых символах", () => {
  const error = "Название не может содержать служебные символы";
  assert.deepEqual(renameFileName("a.pdf", "счёт\u202Efdp.exe"), { name: null, error });
  assert.deepEqual(renameFileName("a.pdf", "счёт\u0007"), { name: null, error });
  assert.deepEqual(renameFileName("a.pdf", "счёт\u200B"), { name: null, error });
});

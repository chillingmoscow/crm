"""Regression coverage for Notion containers, stable files and internal links.
Run with the parser's documented beautifulsoup4/mistune dependencies.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("bundle", pathlib.Path(__file__).parents[1] / "prepare-notion-task-bundle.py")
bundle = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bundle)


class NotionBundleTests(unittest.TestCase):
    def test_synced_blocks_nested_media_and_properties_survive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for name in ["pages", "assets", "aliases", "collections"]:
                (root / name).mkdir()
            ident, child = "a" * 32, "b" * 32
            ref = "https://files.example.com/photo.png?X-Amz-Signature=old-secret"
            data = b"cached-binary"
            binary = root / "assets" / "file.png"
            binary.write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()
            (root / "assets" / "file.json").write_text(json.dumps({"ref": ref, "file": str(binary), "sha256": digest, "bytes": len(data), "mime": "image/png", "name": "photo.png"}))
            content = '''<synced-block-reference url="https://app.notion.com/p/cccccccccccccccccccccccccccccccc">
<b>Сохранить</b> форматирование **инструкции**.
<ol><li>Шаг <b>один</b><image source="https://files.example.com/photo.png?X-Amz-Signature=new-secret" /></li></ol>
<page url="https://app.notion.com/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb">Связанная &amp; страница</page>
<a href="https://app.notion.com/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb">https://app.notion.com/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb</a>
</synced-block-reference>'''
            page = {"id": ident, "title": "Тест", "text": '<properties>{"Телефон":"+70000000000","Проверено":"__YES__","Фото":["' + ref + '"]}</properties><content>' + content + '</content>'}
            (root / "pages" / "root.json").write_text(json.dumps(page))
            (root / "pages" / "child.json").write_text(json.dumps({"id": child, "title": "Связанная", "text": '<ancestor-path><parent-page url="https://app.notion.com/p/' + ident + '"/></ancestor-path><content>Текст</content>'}))
            with contextlib.redirect_stdout(io.StringIO()):
                bundle.prepare(root, root / "out")
            result = json.loads((root / "out" / "bundle.json").read_text())
            serialized = json.dumps(result, ensure_ascii=False)
            self.assertNotIn("secret", serialized)
            self.assertNotIn("X-Amz", serialized)
            self.assertNotIn("app.notion.com", serialized)
            self.assertEqual(result["missingAssets"], [])
            self.assertEqual(len(result["pages"]), 2)
            self.assertEqual(next(p for p in result["pages"] if p["sourceId"] == child)["parentSourceId"], ident)
            self.assertIn("+70000000000", serialized)
            self.assertNotIn("__YES__", serialized)
            self.assertIn("Да", serialized)
            self.assertIn('"bold": true', serialized)
            self.assertIn("bundleasset://" + digest, serialized)
            self.assertIn("notionpage://" + child, serialized)
            self.assertNotIn("notionpage://" + "c" * 32, serialized)
            blocks = next(p for p in result["pages"] if p["sourceId"] == ident)["content"]
            listed = next(b for b in blocks if b["type"] == "numberedListItem")
            self.assertEqual(listed["children"][0]["type"], "image")

    def test_database_uses_native_hierarchy_instead_of_a_duplicate_text_index(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for name in ["pages", "assets", "collections"]:
                (root / name).mkdir()
            owner, view, record, missing = [str(i) * 32 for i in range(1, 5)]
            ds = "collection://11111111-2222-3333-4444-555555555555"
            for ident, title in [(owner, "Каталог"), (view, "View of Каталог")]:
                (root / "pages" / (ident + ".json")).write_text(json.dumps({"id": ident, "title": title, "metadata": {"type": "database"}, "text": '<database><data-source url="{{' + ds + '}}"></data-source></database>'}))
            (root / "pages" / (record + ".json")).write_text(json.dumps({"id": record, "title": "Запись", "metadata": {"type": "page"}, "text": '<ancestor-path><parent-data-source url="' + ds + '"/><ancestor-2-database url="https://app.notion.com/p/' + owner + '"/></ancestor-path><content>Полный текст</content>'}))
            (root / "collections" / "records.json").write_text(json.dumps({"url": ds, "urls": ["https://app.notion.com/" + record, "https://app.notion.com/" + missing]}))
            with contextlib.redirect_stdout(io.StringIO()):
                bundle.prepare(root, root / "out")
            result = json.loads((root / "out" / "bundle.json").read_text())
            pages = {page["sourceId"]: page for page in result["pages"]}
            self.assertEqual(pages[owner]["content"], [])
            self.assertEqual(pages[record]["parentSourceId"], owner)
            self.assertEqual(pages[missing]["parentSourceId"], owner)
            self.assertTrue(pages[missing]["pending"])
            self.assertIn("notionpage://" + owner, json.dumps(pages[view]["content"]))
            self.assertNotIn("notionpage://" + record, json.dumps(pages[owner]["content"]))

    def test_dates_keep_values_without_exposing_storage_columns(self):
        rows = dict(bundle.display_properties({
            "url": "https://app.notion.com/a",
            "date:День рождения:start": "2000-03-02",
            "date:День рождения:is_datetime": 0,
            "date:Пустая дата:is_datetime": 0,
            "date:Встреча:start": "2026-11-07T10:15:00+03:00",
            "date:Встреча:end": "2026-11-07T11:00:00+03:00",
            "date:Встреча:is_datetime": 1,
            "Количество": 0,
            "userDefined:ID": "source-id",
            "userDefined:url": "https://example.com",
            "Проверено": False,
        }))
        self.assertEqual(rows["День рождения"], "02.03.2000")
        self.assertEqual(rows["Встреча"], "07.11.2026 10:15 UTC+03:00 → 07.11.2026 11:00 UTC+03:00")
        self.assertNotIn("Пустая дата", rows)
        self.assertFalse(any(key.startswith("date:") for key in rows))
        self.assertEqual(rows["Количество"], 0)
        self.assertEqual(rows["ID"], "source-id")
        self.assertEqual(rows["url"], "https://example.com")
        self.assertIs(rows["Проверено"], False)

    def test_notion_urls_and_signed_asset_identity(self):
        for url in ["https://app.notion.com/" + "a" * 32, "https://www.notion.so/title-" + "a" * 32, "https://team.notion.site/" + "a" * 32 + "?v=x"]:
            self.assertEqual(bundle.notion_id(url), "a" * 32)
        self.assertIsNone(bundle.notion_id("https://example.com/" + "a" * 32))
        self.assertEqual(bundle.asset_identity("https://files.example/x?X-Amz-Signature=secret"), "https://files.example/x")


if __name__ == "__main__":
    unittest.main()

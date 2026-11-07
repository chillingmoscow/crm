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
</synced-block-reference>'''
            page = {"id": ident, "title": "Тест", "text": '<properties>{"Телефон":"+70000000000","Фото":["' + ref + '"]}</properties><content>' + content + '</content>'}
            (root / "pages" / "root.json").write_text(json.dumps(page))
            (root / "pages" / "child.json").write_text(json.dumps({"id": child, "title": "Связанная", "text": '<ancestor-path><parent-page url="https://app.notion.com/p/' + ident + '"/></ancestor-path><content>Текст</content>'}))
            with contextlib.redirect_stdout(io.StringIO()):
                bundle.prepare(root, root / "out")
            result = json.loads((root / "out" / "bundle.json").read_text())
            serialized = json.dumps(result, ensure_ascii=False)
            self.assertNotIn("secret", serialized)
            self.assertNotIn("X-Amz", serialized)
            self.assertEqual(result["missingAssets"], [])
            self.assertEqual(len(result["pages"]), 2)
            self.assertEqual(next(p for p in result["pages"] if p["sourceId"] == child)["parentSourceId"], ident)
            self.assertIn("+70000000000", serialized)
            self.assertIn('"bold": true', serialized)
            self.assertIn("bundleasset://" + digest, serialized)
            self.assertIn("notionpage://" + child, serialized)
            self.assertNotIn("notionpage://" + "c" * 32, serialized)
            blocks = next(p for p in result["pages"] if p["sourceId"] == ident)["content"]
            listed = next(b for b in blocks if b["type"] == "numberedListItem")
            self.assertEqual(listed["children"][0]["type"], "image")

    def test_notion_urls_and_signed_asset_identity(self):
        for url in ["https://app.notion.com/" + "a" * 32, "https://www.notion.so/title-" + "a" * 32, "https://team.notion.site/" + "a" * 32 + "?v=x"]:
            self.assertEqual(bundle.notion_id(url), "a" * 32)
        self.assertIsNone(bundle.notion_id("https://example.com/" + "a" * 32))
        self.assertEqual(bundle.asset_identity("https://files.example/x?X-Amz-Signature=secret"), "https://files.example/x")


if __name__ == "__main__":
    unittest.main()

"""Prepare an offline, credential-free KB bundle from private Notion fetch/cache files.

Requires beautifulsoup4==4.13.4 and mistune==3.1.3. Never commit the private
source cache: it contains expiring download credentials and operational data.
Usage: python scripts/prepare-notion-task-bundle.py CACHE_DIR OUTPUT_DIR
"""
import hashlib
import html
import json
import pathlib
import re
import shutil
import sys
import urllib.parse
import uuid

import mistune
from bs4 import BeautifulSoup, NavigableString

NOTION = re.compile(r"https://(?:app\.notion\.com/p/|(?:www\.)?notion\.so/)([a-f0-9-]{31,36})(?:[^\s\"<>)]*)", re.I)


def canonical(value):
    return value.replace("-", "").lower()


def body(page):
    match = re.search(r"<content>([\s\S]*?)</content>", page.get("text", ""))
    return match.group(1) if match else ""


def prepare(cache, output, scope_file=None):
    cache, output = pathlib.Path(cache), pathlib.Path(output)
    output.mkdir(parents=True, exist_ok=True)
    (output / "assets").mkdir(exist_ok=True)
    pages = {}
    for path in sorted((cache / "pages").glob("*.json")):
        if path.name.endswith(".assets.json"):
            continue
        page = json.loads(path.read_text())
        if "text" in page:
            pages[canonical(page["id"])] = page
    if scope_file:
        repo = pathlib.Path(__file__).resolve().parents[1]
        roots = json.loads((repo / "docs/automation-migration/notion-tasks-source-2026-11-05.json").read_text())["templates"]
        approved = {canonical(t["sourceId"]) for t in roots} | {canonical(x) for x in json.loads(pathlib.Path(scope_file).read_text())}
        pages = {key: value for key, value in pages.items() if key in approved}
    failed_file = cache / "failed.json"
    failed_ids = {canonical(p["id"]) for p in json.loads(failed_file.read_text())} if failed_file.exists() else set()
    failed_ids.add("ff2d77d85a5b43a1a78f30f9fc2bc334")
    assets, by_ref = {}, {}
    for path in (cache / "assets").glob("*.json"):
        meta = json.loads(path.read_text())
        binary = pathlib.Path(meta["file"]).read_bytes()
        digest = hashlib.sha256(binary).hexdigest()
        if digest != meta["sha256"] or len(binary) != meta["bytes"]:
            raise ValueError("Corrupt cached attachment: " + path.name)
        name = digest + pathlib.Path(meta["file"]).suffix
        assets[digest] = {"sha256": digest, "file": name, "mime": meta["mime"], "bytes": len(binary), "cachedFile": meta["file"]}
        by_ref[meta["ref"]] = digest
    missing_assets, missing_pages, warnings = set(), set(), []
    markdown = mistune.create_markdown(escape=False, plugins=["table", "strikethrough", "url"])

    def link(url):
        match = NOTION.fullmatch(html.unescape(url))
        if match:
            ident = canonical(match.group(1))
            if ident == "768f265590174214b80fa86dbd849267":
                return "/schedule"
            if ident not in pages:
                missing_pages.add(ident)
            return "notionpage://" + ident
        # No executable schemes in imported rich text.
        return url if re.match(r"^(https?://|mailto:|tel:|/)", url, re.I) else ""

    def inline(nodes, styles=None):
        result = []
        for node in nodes:
            if isinstance(node, NavigableString):
                if str(node):
                    result.append({"type": "text", "text": str(node), "styles": styles or {}})
                continue
            if node.name in ["script", "style", "image", "img", "video", "file"]:
                continue
            if node.name == "br":
                result.append({"type": "text", "text": "\n", "styles": styles or {}})
                continue
            new = dict(styles or {})
            for tags, style in [(["b", "strong"], "bold"), (["i", "em"], "italic"), (["s", "del"], "strike"), (["u"], "underline"), (["code"], "code")]:
                if node.name in tags:
                    new[style] = True
            if node.name in ["mention", "page", "database", "synced-block-reference", "link-preview"]:
                href = link(node.get("url", ""))
                target = pages.get(href.replace("notionpage://", ""), {})
                label = node.get_text(" ", strip=True) or target.get("title") or "Связанный материал"
                result.append({"type": "link", "href": href, "content": [{"type": "text", "text": label, "styles": new}]})
            elif node.name == "a":
                href = link(node.get("href", ""))
                children = inline(node.children, new)
                result.extend([{"type": "link", "href": href, "content": children}] if href else children)
            else:
                result.extend(inline(node.children, new))
        return result

    def convert(page):
        source = body(page)
        if canonical(page["id"]) in task_sources:
            source = re.sub(r"в комментар(?:ий|ии)(?: к задаче)?", "в отчёт этой задачи в Sheerly", source, flags=re.I)
            source = re.sub(r" и отметьте (?:управляющего|менеджера)", "", source, flags=re.I)
        if "Обслуживание холодильников" in page.get("title", ""):
            source = source.replace("Неделя месяца", "Группа непрерывного цикла")
            source = "Группы 1–4 чередуются непрерывно, без сброса в начале месяца. Текущая группа указана в задании Sheerly.\n\n" + source
        if "Уборка за холодильниками" in page.get("title", ""):
            source = source.replace("Каждую пятницу", "Каждый понедельник")
        # Properties are part of equipment/reference pages; task scheduling
        # properties remain in native task settings rather than stale prose.
        props = re.search(r"<properties>([\s\S]*?)</properties>", page["text"])
        root_sources = set(task_sources)
        if props and canonical(page["id"]) not in root_sources:
            try:
                properties = json.loads(props.group(1))
                def property_value(v):
                    if isinstance(v, list):
                        return " · ".join(property_value(x) for x in v)
                    if isinstance(v, str) and re.search(r"X-Amz-|X-Goog-", v, re.I):
                        digest = by_ref.get(v)
                        if not digest:
                            missing_assets.add(v)
                            return "Вложение ожидает переноса"
                        tag = "image" if assets[digest]["mime"].startswith("image/") else "file"
                        return '<' + tag + ' source="' + html.escape(v, quote=True) + '" />'
                    return str(v)
                source = "\n".join("**" + str(k) + ":** " + property_value(v) + "\n" for k, v in properties.items() if k != "url" and v not in [None, "", [], {}]) + "\n\n" + source
            except ValueError:
                warnings.append({"source": canonical(page["id"]), "reason": "unparsed_properties"})
        source = re.sub(r"<image\b([^>]*)/?>", r"<image\1></image>", source)
        soup = BeautifulSoup(markdown(source), "html.parser")
        blocks = []
        serial = 0

        def block(kind, content=None, props=None, children=None):
            nonlocal serial
            serial += 1
            row = {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, page["id"] + ":" + str(serial))), "type": kind}
            if content is not None:
                row["content"] = content
            if props:
                row["props"] = props
            if children:
                row["children"] = children
            return row

        def walk(nodes, dest):
            for node in nodes:
                if isinstance(node, NavigableString):
                    if node.strip():
                        dest.append(block("paragraph", inline([node])))
                    continue
                tag = node.name
                if tag in ["script", "style", "colgroup", "table-of-contents"]:
                    continue
                if tag in ["image", "img", "file", "video", "audio"]:
                    ref = html.unescape(node.get("source", node.get("src", "")))
                    digest = by_ref.get(ref)
                    caption = node.get_text(" ", strip=True) or node.get("caption", "") or node.get("alt", "")
                    if digest:
                        kind = "image" if tag in ["image", "img"] else tag
                        dest.append(block(kind, props={"url": "bundleasset://" + digest, "name": urllib.parse.unquote(urllib.parse.parse_qs(urllib.parse.urlparse(ref).query).get("name", [assets[digest]["file"]])[0]), "caption": caption}))
                    elif ref.startswith("notion-file-block://") or tag in ["image", "img"]:
                        missing_assets.add(ref)
                        dest.append(block("paragraph", [{"type": "text", "text": "Вложение недоступно в источнике" + (": " + caption if caption else ""), "styles": {"italic": True}}]))
                    else:
                        dest.append(block("paragraph", [{"type": "link", "href": link(ref), "content": [{"type": "text", "text": caption or "Видео", "styles": {}}]}]))
                elif tag == "table":
                    rows = []
                    for tr in node.find_all("tr"):
                        rows.append({"cells": [inline(td.children) for td in tr.find_all(["td", "th"], recursive=False)]})
                    if rows:
                        width = max(len(r["cells"]) for r in rows)
                        for row in rows:
                            row["cells"] += [[] for _ in range(width-len(row["cells"]))]
                        dest.append(block("table", {"type": "tableContent", "rows": rows}))
                elif tag in ["h1", "h2", "h3", "h4", "h5", "h6"]:
                    dest.append(block("heading", inline(node.children), {"level": min(3, int(tag[1]))}))
                elif tag in ["ul", "ol"]:
                    for li in node.find_all("li", recursive=False):
                        children = []
                        nested = [c for c in li.children if getattr(c, "name", None) in ["ul", "ol"]]
                        walk(nested, children)
                        media = [c for c in li.find_all(["image", "img", "file", "video", "audio"]) if c.find_parent("li") is li]
                        walk(media, children)
                        dest.append(block("numberedListItem" if tag == "ol" else "bulletListItem", inline(c for c in li.children if c not in nested), children=children))
                elif tag in ["p", "todo", "blockquote", "quote", "pre"]:
                    if node.find(["image", "img", "file", "video", "table"]):
                        walk(node.children, dest)
                    else:
                        content = inline(node.children)
                        if content:
                            dest.append(block("checkListItem" if tag == "todo" else "paragraph", content, {"checked": node.get("checked") == "true"} if tag == "todo" else None))
                elif tag == "unknown":
                    warnings.append({"source": canonical(page["id"]), "reason": "unsupported_" + node.get("alt", "block")})
                elif tag in ["mention", "page", "database", "synced-block-reference", "link-preview"]:
                    dest.append(block("paragraph", inline([node])))
                else:
                    walk(node.children, dest)
        walk(soup.children, blocks)
        # Safety net for media nested in legacy containers unsupported by
        # BlockNote (for example images inside an HTML table cell).
        for media in soup.find_all(["image", "img", "file", "video", "audio"]):
            ref = html.unescape(media.get("source", media.get("src", "")))
            digest = by_ref.get(ref)
            if digest and ("bundleasset://" + digest) not in json.dumps(blocks):
                walk([media], blocks)
        if page.get("truncated") or page.get("unknown_block_count"):
            warnings.append({"source": canonical(page["id"]), "reason": "source_truncated_or_unknown_blocks"})
        return blocks

    repo = pathlib.Path(__file__).resolve().parents[1]
    task_sources = json.loads((repo / "docs/automation-migration/notion-tasks-source-2026-11-05.json").read_text())["templates"]
    task_sources = {canonical(t["sourceId"]): t for t in task_sources}
    result = []
    for ident, page in pages.items():
        result.append({"sourceId": ident, "title": page.get("title") or "Без названия", "content": convert(page)})
    for ident in sorted(missing_pages):
        result.append({"sourceId": ident, "title": ("Недоступная страница · " if ident in failed_ids else "Связанный материал · ") + ident[:8], "unavailable": ident in failed_ids, "pending": ident not in failed_ids, "content": [{"type": "paragraph", "content": [{"type": "text", "text": ("Notion возвращает «страница не найдена». " if ident in failed_ids else "Материал ещё не перенесён. ") + "Исходный идентификатор: " + ident, "styles": {}}]}]})
    used_assets = set(re.findall(r"bundleasset://([a-f0-9]{64})", json.dumps(result)))
    assets = {key: value for key, value in assets.items() if key in used_assets}
    for asset in assets.values():
        shutil.copyfile(asset.pop("cachedFile"), output / "assets" / asset["file"])
    for path in (output / "assets").iterdir():
        if path.name not in {a["file"] for a in assets.values()} and re.fullmatch(r"[a-f0-9]{64}\.[a-z0-9]+", path.name):
            path.unlink()
    manifest = {"schemaVersion": 1, "pages": result, "assets": list(assets.values()), "missingAssets": [hashlib.sha256(ref.encode()).hexdigest() for ref in sorted(missing_assets)], "warnings": warnings}
    (output / "bundle.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(json.dumps({"pages": len(result), "unavailablePages": len(missing_pages & failed_ids), "pendingPages": len(missing_pages - failed_ids), "files": len(assets), "missingAssets": len(missing_assets), "warnings": len(warnings)}))


if __name__ == "__main__":
    prepare(*sys.argv[1:])

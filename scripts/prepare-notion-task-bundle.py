"""Prepare an offline, credential-free KB bundle from private Notion fetch/cache files.

Requires beautifulsoup4==4.13.4 and mistune==3.1.3. Never commit the private
source cache: it contains expiring download credentials and operational data.
Usage: python scripts/prepare-notion-task-bundle.py CACHE_DIR OUTPUT_DIR
"""
from collections import Counter, defaultdict

from datetime import datetime

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

NOTION = re.compile(r"https://(?:app\.notion\.com/|(?:www\.)?notion\.so/|[a-z0-9-]+\.notion\.site/)[^\s\"<>)]*", re.I)


def notion_id(url):
    url = html.unescape(url).strip("{}")
    if not NOTION.fullmatch(url):
        return None
    path = urllib.parse.urlparse(html.unescape(url)).path.rstrip("/")
    match = re.search(r"([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{31})$", path, re.I)
    return canonical(match.group(1)) if match else None


def asset_identity(ref):
    if ref.startswith("notion-file-block://") or re.search(r"[?&](?:X-Amz-|X-Goog-)", ref, re.I):
        return urllib.parse.urlsplit(ref)._replace(query="", fragment="").geturl()
    return ref


def canonical(value):
    return value.replace("-", "").lower()


def display_properties(properties):
    """Fold Notion's date storage columns into their original field labels."""
    rows, dates = [], {}
    for key, value in properties.items():
        match = re.fullmatch(r"date:(.*):(start|end|is_datetime)", key)
        if match:
            dates.setdefault(match.group(1), {})[match.group(2)] = value
        elif key != "url" and value not in [None, "", [], {}]:
            rows.append((key.removeprefix("userDefined:"), value))

    def date_text(value, with_time):
        if not value:
            return ""
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            result = parsed.strftime("%d.%m.%Y")
            if with_time:
                result += parsed.strftime(" %H:%M")
                if parsed.second or parsed.microsecond:
                    result += parsed.strftime(":%S")
                if parsed.microsecond:
                    result += (".%06d" % parsed.microsecond).rstrip("0")
                offset = parsed.strftime("%z")
                if offset:
                    result += " UTC" + offset[:3] + ":" + offset[3:]
            return result
        except (ValueError, TypeError):
            return str(value)

    for key, value in dates.items():
        start = date_text(value.get("start"), bool(value.get("is_datetime")))
        end = date_text(value.get("end"), bool(value.get("is_datetime")))
        if start or end:
            rows.append((key, " → ".join(part for part in [start, end] if part)))
    return rows


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
    for failure in cache.glob("failures-batch-*.json"):
        failed_ids.update(canonical(p["id"]) for p in json.loads(failure.read_text()))
    aliases = {}
    for path in (cache / "aliases").glob("*.json"):
        alias = json.loads(path.read_text())
        aliases[canonical(alias["id"])] = canonical(alias["canonicalId"])
    collections = {}
    for path in (cache / "collections").glob("*.json"):
        collection = json.loads(path.read_text())
        previous = collections.setdefault(collection["url"], {"urls": []})
        previous["urls"] = sorted(set(previous["urls"]) | set(collection.get("urls", [])))
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
        by_ref[asset_identity(meta["ref"])] = digest
        assets[digest]["name"] = meta.get("name") or pathlib.Path(meta["file"]).name
    missing_assets, missing_pages, warnings = set(), set(), []
    markdown = mistune.create_markdown(escape=False, plugins=["table", "strikethrough", "url"])
    owner_votes, owner_candidates = defaultdict(Counter), defaultdict(set)
    for ident, page in pages.items():
        text = page["text"]
        parent = re.search(r'<ancestor-path>\s*<parent-data-source\b[^>]*url="([^"]+)"[^>]*>\s*<ancestor-\d+-database\b[^>]*url="([^"]+)"', text)
        if parent:
            owner = notion_id(parent.group(2))
            if owner in pages:
                owner_votes[parent.group(1).strip("{}")][owner] += 1
        if page.get("metadata", {}).get("type") == "database":
            for ds in re.findall(r'<data-source\s+url="\{?\{?(collection://[a-f0-9-]{36})', text):
                owner_candidates[ds].add(ident)
    data_source_owners = {}
    for ds in set(owner_votes) | set(owner_candidates):
        ranked = sorted(owner_candidates[ds] | set(owner_votes[ds]), key=lambda ident: (-owner_votes[ds][ident], pages[ident].get("title", "").startswith("View of"), ident))
        if ranked:
            data_source_owners[ds] = ranked[0]
    record_parents = {}
    for ds, collection in collections.items():
        for url in collection.get("urls", []):
            ident = aliases.get(notion_id(url), notion_id(url))
            if ident:
                record_parents[ident] = data_source_owners.get(ds)


    def link(url):
        digest = by_ref.get(asset_identity(html.unescape(url)))
        if digest:
            return "bundleasset://" + digest
        if re.search(r"X-Amz-|X-Goog-", url, re.I):
            missing_assets.add(url)
            return ""
        ident = notion_id(url)
        if ident:
            ident = aliases.get(ident, ident)
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
            if node.name in ["mention", "page", "database", "link-preview"]:
                href = link(node.get("url", ""))
                target = pages.get(href.replace("notionpage://", ""), {})
                label = node.get_text(" ", strip=True) or target.get("title") or "Связанный материал"
                result.append({"type": "link", "href": href, "content": [{"type": "text", "text": label, "styles": new}]})
            elif node.name == "a":
                href = link(node.get("href", ""))
                children = inline(node.children, new)
                target_id = notion_id(node.get("href", ""))
                if target_id and node.get_text().strip() == node.get("href", ""):
                    target_id = aliases.get(target_id, target_id)
                    label = pages.get(target_id, {}).get("title") or "Связанная страница"
                    children = [{"type": "text", "text": label, "styles": new}]
                if re.search(r"X-Amz-|X-Goog-", node.get("href", ""), re.I):
                    for child in children:
                        if child.get("type") == "text" and re.search(r"X-Amz-|X-Goog-", child.get("text", ""), re.I):
                            child["text"] = "Вложение"
                result.extend([{"type": "link", "href": href, "content": children}] if href else children)
            else:
                result.extend(inline(node.children, new))
        return result

    def convert(page):
        source = body(page)
        if canonical(page["id"]) in task_sources:
            source = re.sub(r"в комментар(?:ий|ии)(?: к задаче)?", "в отчёт этой задачи в Sheerly", source, flags=re.I)
            source = re.sub(r" и отметьте (?:управляющего|менеджера)", "", source, flags=re.I)
            source = re.sub(r"Отправьте фотоотч[её]т о выполнении задачи в отч[её]т этой задачи в Sheerly\.?", "Приложите фотографию выполненной работы к отчёту задачи в Sheerly.", source, flags=re.I)
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
                    if isinstance(v, bool):
                        return "Да" if v else "Нет"
                    if isinstance(v, str) and v in ["__YES__", "__NO__"]:
                        return "Да" if v == "__YES__" else "Нет"
                    if isinstance(v, list):
                        return " · ".join(property_value(x) for x in v)
                    if isinstance(v, str) and re.search(r"X-Amz-|X-Goog-", v, re.I):
                        digest = by_ref.get(asset_identity(v))
                        if not digest:
                            missing_assets.add(v)
                            return "Вложение ожидает переноса"
                        tag = "image" if assets[digest]["mime"].startswith("image/") else "file"
                        return '<' + tag + ' source="' + html.escape(v, quote=True) + '" />'
                    if isinstance(v, dict):
                        return " · ".join(html.escape(str(k)) + ": " + property_value(x) for k, x in v.items() if x not in [None, "", [], {}])
                    if isinstance(v, str):
                        return html.escape(v)
                    return html.escape(str(v))
                source = "\n".join("**" + str(k) + ":** " + property_value(v) + "\n" for k, v in display_properties(properties)) + "\n\n" + source
            except ValueError:
                warnings.append({"source": canonical(page["id"]), "reason": "unparsed_properties"})
        for metadata_tag in ["coverMetadata", "iconMetadata"]:
            metadata = re.search(r"<" + metadata_tag + r">([\s\S]*?)</" + metadata_tag + ">", page["text"])
            if metadata:
                try:
                    value = json.loads(metadata.group(1))
                    if not value:
                        continue
                    ref = value.get("file", value.get("external", {})).get("url", "")
                    if ref:
                        source = '<image data-page-icon="' + ('true' if metadata_tag == 'iconMetadata' else 'false') + '" source="' + html.escape(ref, quote=True) + '"></image>\n\n' + source
                except (ValueError, AttributeError):
                    warnings.append({"source": canonical(page["id"]), "reason": "unparsed_cover_or_icon"})
        for ds in re.findall(r'<data-source\b[^>]*url="\{?\{?(collection://[a-f0-9-]{36})', page["text"]):
            # Register completeness without rendering thousands of duplicate
            # BlockNote paragraphs: the native children list is the index.
            for url in collections.get(ds, {}).get("urls", []):
                link(url)
            owner = data_source_owners.get(ds)
            if owner and owner != canonical(page["id"]):
                source += '\n\n<page url="https://app.notion.com/p/' + owner + '">Записи базы: ' + html.escape(pages[owner].get("title", "База")) + '</page>'
        source = re.sub(r"<(image|file|pdf|audio|video|mention|page|database)\b([^>]*?)/>", r"<\1\2></\1>", source)
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
            pending = []
            inline_tags = {"a", "b", "strong", "i", "em", "s", "del", "u", "code", "span", "br", "mention", "link-preview"}
            def flush():
                if not pending:
                    return
                fragment = "".join(str(n) for n in pending).strip()
                pending.clear()
                if fragment:
                    parsed = BeautifulSoup(markdown(fragment), "html.parser")
                    for item in parsed.children:
                        if isinstance(item, NavigableString):
                            if item.strip():
                                dest.append(block("paragraph", inline([item])))
                        elif item.name == "p":
                            dest.append(block("paragraph", inline(item.children)))
                        else:
                            walk([item], dest)
            for node in nodes:
                if isinstance(node, NavigableString) or node.name in inline_tags:
                    pending.append(node)
                    continue
                flush()
                tag = node.name
                if tag in ["script", "style", "colgroup", "table-of-contents"]:
                    continue
                if tag in ["image", "img", "file", "pdf", "video", "audio"]:
                    ref = html.unescape(node.get("source", node.get("src", "")))
                    digest = by_ref.get(asset_identity(ref))
                    caption = node.get_text(" ", strip=True) or node.get("caption", "") or node.get("alt", "")
                    if digest:
                        kind = "image" if tag in ["image", "img"] else "file" if tag == "pdf" else tag
                        dest.append(block(kind, props={"url": "bundleasset://" + digest, "name": assets[digest]["name"], "caption": caption, **({"previewWidth": 64} if node.get("data-page-icon") == "true" else {})}))
                    elif ref.startswith("notion-file-block://") or re.search(r"X-Amz-|X-Goog-", ref, re.I) or tag in ["image", "img"]:
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
                        walk(li.children, children)
                        first = children.pop(0) if children and children[0]["type"] == "paragraph" else None
                        dest.append(block("numberedListItem" if tag == "ol" else "bulletListItem", first["content"] if first else [], children=children))
                elif tag in ["p", "todo", "blockquote", "quote", "pre"]:
                    if node.find(["image", "img", "file", "pdf", "video", "audio", "table", "synced-block", "synced-block-reference"]):
                        walk(node.children, dest)
                    else:
                        content = inline(node.children)
                        if content:
                            dest.append(block("checkListItem" if tag == "todo" else "paragraph", content, {"checked": node.get("checked") == "true"} if tag == "todo" else None))
                elif tag == "unknown":
                    warnings.append({"source": canonical(page["id"]), "reason": "unsupported_" + node.get("alt", "block")})
                    dest.append(block("paragraph", [{"type": "text", "text": "Элемент Notion не поддерживается: " + node.get("alt", "блок"), "styles": {"italic": True}}]))
                    walk(node.children, dest)
                elif tag in ["mention", "page", "database", "link-preview"]:
                    dest.append(block("paragraph", inline([node])))
                else:
                    walk(node.children, dest)
            flush()
        walk(soup.children, blocks)
        # Safety net for media nested in legacy containers unsupported by
        # BlockNote (for example images inside an HTML table cell).
        for media in soup.find_all(["image", "img", "file", "pdf", "video", "audio"]):
            ref = html.unescape(media.get("source", media.get("src", "")))
            digest = by_ref.get(asset_identity(ref))
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
        parent = re.search(r'<ancestor-path>\s*<parent-(?:page|database)\b[^>]*url="([^"]+)"', page["text"])
        parent_id = notion_id(parent.group(1)) if parent else None
        parent_ds = re.search(r'<ancestor-path>\s*<parent-data-source\b[^>]*url="([^"]+)"', page["text"])
        if parent_ds:
            ancestor_db = re.search(r'<ancestor-path>\s*<parent-data-source\b[^>]*>\s*<ancestor-\d+-database\b[^>]*url="([^"]+)"', page["text"])
            parent_id = notion_id(ancestor_db.group(1)) if ancestor_db else None
            if parent_id not in pages:
                parent_id = data_source_owners.get(parent_ds.group(1).strip("{}"))
        result.append({"sourceId": ident, "title": page.get("title") or "Без названия", "parentSourceId": aliases.get(parent_id, parent_id), "sourceKind": page.get("metadata", {}).get("type", "page"), "icon": page.get("icon") if isinstance(page.get("icon"), str) and not page["icon"].startswith("http") else None, "sourceEditedAt": page.get("page_last_edited_at"), "content": convert(page)})
    for ident in sorted(missing_pages):
        result.append({"sourceId": ident, "parentSourceId": record_parents.get(ident), "title": ("Недоступная страница · " if ident in failed_ids else "Связанный материал · ") + ident[:8], "unavailable": ident in failed_ids, "pending": ident not in failed_ids, "content": [{"type": "paragraph", "content": [{"type": "text", "text": ("Notion возвращает «страница не найдена». " if ident in failed_ids else "Материал ещё не перенесён. ") + "Исходный идентификатор: " + ident, "styles": {}}]}]})
    used_assets = set(re.findall(r"bundleasset://([a-f0-9]{64})", json.dumps(result)))
    assets = {key: value for key, value in assets.items() if key in used_assets}
    for asset in assets.values():
        shutil.copyfile(asset.pop("cachedFile"), output / "assets" / asset["file"])
    for path in (output / "assets").iterdir():
        if path.name not in {a["file"] for a in assets.values()} and re.fullmatch(r"[a-f0-9]{64}\.[a-z0-9]+", path.name):
            path.unlink()
    manifest = {"schemaVersion": 1, "pages": result, "assets": list(assets.values()), "missingAssets": [hashlib.sha256(ref.encode()).hexdigest() for ref in sorted(missing_assets)], "warnings": warnings}
    serialized = json.dumps(manifest, ensure_ascii=False, indent=2)
    if re.search(r"X-Amz-(?:Signature|Credential)|X-Goog-(?:Signature|Credential)", serialized, re.I):
        raise ValueError("Credential-bearing source URL in prepared bundle")
    (output / "bundle.json").write_text(serialized)
    print(json.dumps({"pages": len(result), "unavailablePages": len(missing_pages & failed_ids), "pendingPages": len(missing_pages - failed_ids), "files": len(assets), "missingAssets": len(missing_assets), "warnings": len(warnings)}))


if __name__ == "__main__":
    prepare(*sys.argv[1:])

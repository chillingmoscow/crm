// The CRM database contains guest records, including rows without contact fields.
const personalDatabases = new Set(["e556f0fffae34b4795a40d4cd306732a"]);
const personalFields =
  /^(?:фио|имя\s*\/?\s*фамилия|дата рождения|паспортные данные):$/iu;
const personalRelations = /^(?:гости|любят):$/iu;
const privateLinkText = "Личная карточка пропущена";
const referencePattern =
  /(?:notionpage:\/\/|\/knowledge\/notion-[0-9a-f-]{36}-)([0-9a-f]{31,32})(?:#[^\s"'<>)]*)?/gi;

function propertyLabel(block) {
  const first = Array.isArray(block.content) ? block.content[0] : null;
  return first?.type === "text" && first.styles?.bold ? first.text.trim() : "";
}

const notionUrlPattern =
  /https:\/\/(?:app\.notion\.com|(?:www\.)?notion\.so|[a-z0-9-]+\.notion\.site)\/[^\s"'<>)]*/gi;

function redactReferenceText(text, excluded) {
  return text
    .replace(referencePattern, (whole, id) =>
      excluded.has(id.toLowerCase()) ? privateLinkText : whole,
    )
    .replace(notionUrlPattern, (url) => {
      const id = new URL(url).pathname
        .replace(/\/$/, "")
        .match(
          /([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{31})$/i,
        )?.[1]
        .replaceAll("-", "")
        .toLowerCase();
      return id && excluded.has(id) ? privateLinkText : url;
    });
}

/** Drop the label of a personal link as well as its URL. Link labels may be names. */
export function stripPersonalNotionReferences(value, excluded) {
  if (typeof value === "string") return redactReferenceText(value, excluded);
  if (Array.isArray(value)) {
    return value
      .filter(
        (block) =>
          !block ||
          typeof block !== "object" ||
          !personalRelations.test(propertyLabel(block)),
      )
      .map((item) => stripPersonalNotionReferences(item, excluded));
  }
  if (!value || typeof value !== "object") return value;
  if (
    typeof value.href === "string" &&
    redactReferenceText(value.href, excluded) !== value.href
  )
    return { type: "text", text: privateLinkText, styles: {} };
  if (
    typeof value.props?.url === "string" &&
    redactReferenceText(value.props.url, excluded) !== value.props.url
  )
    return {
      id: value.id,
      type: "paragraph",
      content: [{ type: "text", text: privateLinkText, styles: {} }],
    };
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      stripPersonalNotionReferences(item, excluded),
    ]),
  );
}

/** Keep operational pages, skipping a personal database and all its descendants. */
export function scopeNotionBundle(bundle) {
  const excluded = new Set(personalDatabases);
  const children = new Map();
  for (const page of bundle.pages) {
    if (page.content.some((block) => personalFields.test(propertyLabel(block))))
      excluded.add(page.sourceId);
    if (!children.has(page.parentSourceId))
      children.set(page.parentSourceId, []);
    children.get(page.parentSourceId).push(page.sourceId);
  }
  for (const id of excluded)
    for (const child of children.get(id) ?? []) excluded.add(child);

  const pages = bundle.pages
    .filter((page) => !excluded.has(page.sourceId))
    .map((page) => ({
      ...page,
      content: stripPersonalNotionReferences(page.content, excluded),
    }));
  const used = new Set();
  for (const page of pages)
    for (const match of JSON.stringify(page.content).matchAll(
      /bundleasset:\/\/([0-9a-f]{64})/g,
    ))
      used.add(match[1]);
  return {
    pages,
    assets: bundle.assets.filter((asset) => used.has(asset.sha256)),
    excluded,
  };
}

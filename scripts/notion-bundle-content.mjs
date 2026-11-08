/** Keep ownership of imported text separate from the text's current hash.
 * Manual edits never become import-owned after an enrichment-only pass.
 */
export function mergeImportedContent({ current, incoming, previousHash, currentHash, generated = false, seenMedia = [] }) {
  if (!current?.length || generated || previousHash === currentHash || JSON.stringify(current) === JSON.stringify(incoming))
    return { content: incoming, manuallyEdited: false };
  const existing = JSON.stringify(current);
  const seen = new Set(seenMedia);
  const media = [];
  function collect(blocks) {
    for (const block of blocks) {
      if (["image", "file", "video", "audio"].includes(block.type) && block.props?.url && !existing.includes(block.props.url) && !seen.has(block.props.url))
        media.push(block);
      if (block.children) collect(block.children);
    }
  }
  collect(incoming);
  const unique = new Map(media.map((block) => [block.props.url, block]));
  return { content: [...current, ...unique.values()], manuallyEdited: true };
}


export function importedMediaUrls(blocks) {
  const urls = new Set();
  function visit(nodes) {
    for (const block of nodes ?? []) {
      if (["image", "file", "video", "audio"].includes(block.type) && block.props?.url)
        urls.add(block.props.url);
      if (block.children) visit(block.children);
    }
  }
  visit(blocks);
  return [...urls];
}

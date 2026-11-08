/** Recognize the placeholders created by import-notion-task-bundle.mjs. */
export function isUnavailableNotionPage(page: { slug: string; title: string }): boolean {
  const sourceId = /^notion-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}-([a-f0-9]{31,32})$/.exec(page.slug)?.[1];
  return sourceId !== undefined && page.title === `Недоступная страница · ${sourceId.slice(0, 8)}`;
}

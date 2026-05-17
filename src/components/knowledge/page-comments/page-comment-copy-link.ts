/** Deep-link к конкретному комментарию: <page-url без query/hash>#comment-<id>. */
export function buildCommentLink(href: string, commentId: string): string {
  const base = href.split("#")[0].split("?")[0];
  return `${base}#comment-${commentId}`;
}

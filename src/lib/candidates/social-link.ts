/**
 * Ссылка на соцсеть кандидата для анкеты: куда вести и что показать.
 *
 * Кандидаты присылают и голый ник («gggeraaa», «@gggeraaa»), и полную ссылку
 * с хвостом трекинга («https://www.instagram.com/gggeraaa?igsh=…»). Длинная
 * ссылка в анкете не помещается и выглядит как мусор, поэтому показываем
 * короткое имя — «@gggeraaa», — а ссылку оставляем адресом перехода.
 */
export type SocialKind = "instagram" | "telegram" | "vk";

const HOSTS: Record<SocialKind, { base: string; hosts: string[] }> = {
  instagram: { base: "https://www.instagram.com/", hosts: ["instagram.com", "instagr.am"] },
  telegram: { base: "https://t.me/", hosts: ["t.me", "telegram.me"] },
  vk: { base: "https://vk.com/", hosts: ["vk.com", "vk.ru", "m.vk.com"] },
};

const HANDLE = /^@?([A-Za-z0-9_.]{2,64})$/;

export type SocialLink = {
  /** Короткая подпись: «@ник» или домен, если ник не выделить. */
  label: string;
  /** Безопасный http(s)-адрес или null, если перейти некуда. */
  href: string | null;
};

function parseUrl(value: string): URL | null {
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

export function socialLink(kind: string, raw: string): SocialLink {
  const value = raw.trim();
  const known = (HOSTS as Record<string, (typeof HOSTS)[SocialKind] | undefined>)[kind];

  const bare = value.match(HANDLE);
  if (bare) {
    const handle = bare[1];
    return {
      label: kind === "vk" ? handle : `@${handle}`,
      href: known ? `${known.base}${handle}` : null,
    };
  }

  const url = value.includes(".") || /^https?:\/\//i.test(value) ? parseUrl(value) : null;
  if (!url) return { label: value, href: null };

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const first = url.pathname.split("/").filter(Boolean)[0];
  const ownHost = known?.hosts.includes(host) ?? false;
  if (ownHost && first && HANDLE.test(first)) {
    const handle = first.replace(/^@/, "");
    return { label: kind === "vk" ? handle : `@${handle}`, href: url.toString() };
  }
  return { label: host, href: url.toString() };
}

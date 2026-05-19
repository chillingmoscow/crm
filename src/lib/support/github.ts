/**
 * Server-only GitHub helper для создания issue из формы поддержки.
 * Без octokit — голый fetch к api.github.com. Конфиг через env по
 * паттерну src/lib/dadata/client.ts / src/lib/ai/deepseek-client.ts.
 * Никогда не импортировать в client-код (токен серверный).
 */

const API = "https://api.github.com";

interface GithubConfig {
  token: string;
  owner: string;
  repo: string;
}

function getGithubConfig(): GithubConfig | null {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO; // формат "owner/repo"
  if (!token || !repo || !repo.includes("/")) return null;
  const [owner, name] = repo.split("/");
  if (!owner || !name) return null;
  return { token, owner, repo: name };
}

export function isGithubConfigured(): boolean {
  return getGithubConfig() !== null;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

/**
 * Best-effort: убедиться, что метка существует (иначе создание issue с
 * несуществующей меткой её просто проигнорирует). 404 → создаём.
 * Любая ошибка не критична — глотаем.
 */
async function ensureLabel(
  cfg: GithubConfig,
  name: string,
  color: string,
): Promise<void> {
  try {
    const res = await fetch(
      `${API}/repos/${cfg.owner}/${cfg.repo}/labels/${encodeURIComponent(name)}`,
      { headers: headers(cfg.token) },
    );
    if (res.status === 200) return;
    if (res.status === 404) {
      await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/labels`, {
        method: "POST",
        headers: headers(cfg.token),
        body: JSON.stringify({ name, color }),
      });
    }
  } catch {
    // best-effort — метка не критична для создания issue
  }
}

const LABEL_COLORS: Record<string, string> = {
  "user-report": "5319e7",
  bug: "d73a4a",
  idea: "0e8a16",
  question: "d876e3",
};

export interface CreateIssueResult {
  url: string;
  number: number;
}

/**
 * Создаёт issue. Бросает при ошибке — вызывающий обязан обернуть в
 * try/catch (GitHub — best-effort канал, email гарантирован).
 */
export async function createSupportIssue(args: {
  title: string;
  body: string;
  labels: string[];
}): Promise<CreateIssueResult> {
  const cfg = getGithubConfig();
  if (!cfg) throw new Error("GitHub не сконфигурирован");

  for (const label of args.labels) {
    await ensureLabel(cfg, label, LABEL_COLORS[label] ?? "ededed");
  }

  const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/issues`, {
    method: "POST",
    headers: headers(cfg.token),
    body: JSON.stringify({
      title: args.title,
      body: args.body,
      labels: args.labels,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub issue не создан (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { html_url: string; number: number };
  return { url: json.html_url, number: json.number };
}

"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  Settings2,
  Archive,
  ArrowLeft,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TablePageHeader } from "@/components/shared/table/table-page-header";
import {
  STATUSES,
  STATUS_CLASSES,
  type Candidate,
  type CandidatePermissions,
  type HiringOptions,
} from "@/lib/candidates/types";
import { listCandidates, updateCandidate } from "../actions";
import { FieldSelect, StatusBadge, dateLabel, plural } from "./fields";
import { CandidateForm } from "./candidate-form";
import { RecruitingSettings } from "./recruiting-settings";
export function CandidatesClient({
  initial,
  options,
  permissions,
  archive = false,
}: {
  initial: { rows: Candidate[]; total: number };
  options: HiringOptions;
  permissions: CandidatePermissions;
  archive?: boolean;
}) {
  const router = useRouter(),
    [data, setData] = useState(initial),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [position, setPosition] = useState(""),
    [responsible, setResponsible] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [page, setPage] = useState(0),
    [view, setView] = useState<"board" | "table">("board"),
    [creating, setCreating] = useState(false),
    [settings, setSettings] = useState(false),
    [error, setError] = useState(""),
    [busy, start] = useTransition();
  const params = useSearchParams();
  useEffect(() => {
    if (params.get("settings") === "1" && permissions.integrations)
      setSettings(true);
  }, [params, permissions.integrations]);
  const first = useRef(true);
  const positions = Array.from(
    new Set(
      initial.rows
        .map((c) => c.desired_position)
        .filter((p): p is string => Boolean(p)),
    ),
  ).sort();
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let active = true;
    start(async () => {
      try {
        const next = await listCandidates({
          search: query,
          status,
          position,
          responsible,
          from: from || undefined,
          to: to || undefined,
          archive,
          page,
        });
        if (active) {
          setData(next);
          setError("");
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить анкеты",
          );
      }
    });
    return () => {
      active = false;
    };
  }, [query, status, position, responsible, from, to, archive, page]);
  const refresh = async () =>
    setData(
      await listCandidates({
        search: query,
        status,
        position,
        responsible,
        from: from || undefined,
        to: to || undefined,
        archive,
        page,
      }),
    );
  const drop = (event: React.DragEvent, key: string) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain"),
      c = data.rows.find((c) => c.id === id);
    if (
      !c ||
      key === "hired" ||
      c.status === "hired" ||
      !permissions.manage ||
      archive
    )
      return;
    start(async () => {
      try {
        await updateCandidate(id, { revision: c.revision, status: key });
        await refresh();
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Не удалось сменить статус",
        );
      }
    });
  };
  return (
    <div className="flex min-w-0 flex-col gap-6 p-4 md:p-8">
      <TablePageHeader
        title={archive ? "Архив кандидатов" : "Кандидаты"}
        subtitle="Общий список кандидатов аккаунта"
        actions={
          <>
            {archive ? (
              <Button variant="outline" asChild>
                <Link href="/people/candidates">
                  <ArrowLeft className="mr-2 h-4 w-4" />К кандидатам
                </Link>
              </Button>
            ) : null}
            {permissions.owner && !archive ? (
              <Button variant="ghost" asChild>
                <Link href="/people/candidates/archive">
                  <Archive className="mr-2 h-4 w-4" />
                  Архив
                </Link>
              </Button>
            ) : null}
            {permissions.integrations && !archive ? (
              <Button variant="outline" onClick={() => setSettings(true)}>
                <Settings2 className="mr-2 h-4 w-4" />
                Настройки
              </Button>
            ) : null}
            {permissions.manage && !archive ? (
              <Button onClick={() => setCreating(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Добавить кандидата
              </Button>
            ) : null}
          </>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-0 flex-1 basis-52">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Поиск кандидатов"
            placeholder="Имя, телефон или должность"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <FieldSelect
          label="Статус"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(0);
          }}
          options={[
            { value: "", label: "Все статусы" },
            ...Object.entries(STATUSES).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
        <FieldSelect
          label="Должность"
          value={position}
          onChange={(v) => {
            setPosition(v);
            setPage(0);
          }}
          options={[
            { value: "", label: "Все должности" },
            ...positions.map((p) => ({ value: p, label: p })),
          ]}
        />
        <FieldSelect
          label="Ответственный"
          value={responsible}
          onChange={(v) => {
            setResponsible(v);
            setPage(0);
          }}
          options={[
            { value: "", label: "Все" },
            ...options.members.map((m) => ({ value: m.id, label: m.name })),
          ]}
        />
        <div className="flex max-w-full items-end gap-2">
          <label className="text-xs text-muted-foreground">
            Заявки с
            <Input
              aria-label="Заявки с"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            по
            <Input
              aria-label="Заявки по"
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(0);
              }}
            />
          </label>
        </div>
        <div className="flex rounded-md border p-1">
          <Button
            variant={view === "board" ? "secondary" : "ghost"}
            size="icon"
            aria-label="Доска"
            aria-pressed={view === "board"}
            onClick={() => setView("board")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "table" ? "secondary" : "ghost"}
            size="icon"
            aria-label="Таблица"
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div
        className="flex items-center justify-between text-sm text-muted-foreground"
        aria-live="polite"
      >
        <span>
          {data.total} {plural(data.total, ["анкета", "анкеты", "анкет"])}
          {busy ? " · Обновляем…" : ""}
        </span>
        {data.total > 100 ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={page === 0 || busy}
              onClick={() => setPage((p) => p - 1)}
            >
              Назад
            </Button>
            <span>{page + 1}</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={(page + 1) * 100 >= data.total || busy}
              onClick={() => setPage((p) => p + 1)}
            >
              Далее
            </Button>
          </div>
        ) : null}
      </div>
      {error ? (
        <div role="alert" className="text-destructive">
          {error}
        </div>
      ) : null}
      {data.rows.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
          <UserRound className="h-8 w-8 text-muted-foreground" />
          <h2 className="text-xl font-semibold">
            {query || status || from || to
              ? "По этим условиям анкет нет"
              : archive
                ? "Архив пуст"
                : "Пока нет кандидатов"}
          </h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            {archive
              ? "Архивированные анкеты появятся здесь."
              : "Добавьте кандидата вручную или подключите анкету на Тильде в настройках."}
          </p>
        </div>
      ) : view === "board" ? (
        <div className="flex min-w-0 gap-4 overflow-x-auto pb-4">
          {Object.entries(STATUSES)
            .filter(([key]) => !status || key === status)
            .filter(
              ([key]) =>
                key !== "unknown" ||
                data.rows.some((c) => c.status === "unknown"),
            )
            .map(([key, label]) => (
              <section
                key={key}
                aria-label={label}
                className="w-72 shrink-0 rounded-xl bg-muted/40 p-3"
                onDragOver={(e) => {
                  if (permissions.manage && key !== "hired") e.preventDefault();
                }}
                onDrop={(e) => drop(e, key)}
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <h2 className="text-sm font-medium">{label}</h2>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {data.rows.filter((c) => c.status === key).length}
                  </span>
                </div>
                <div className="space-y-2">
                  {data.rows
                    .filter((c) => c.status === key)
                    .map((c) => (
                      <Link
                        key={c.id}
                        href={`/people/candidates/${c.id}`}
                        draggable={
                          permissions.manage && !archive && c.status !== "hired"
                        }
                        onDragStart={(e) =>
                          e.dataTransfer.setData("text/plain", c.id)
                        }
                        className="block rounded-lg border bg-card p-3 transition-colors hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        <div className="flex items-start gap-3">
                          {c.photo_url ? (
                            <Image
                              unoptimized
                              width={40}
                              height={40}
                              src={c.photo_url}
                              alt=""
                              className="size-10 shrink-0 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-medium text-muted-foreground">
                              {c.full_name.slice(0, 1)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="break-words text-sm font-medium">
                              {c.full_name}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {c.desired_position ?? "Должность не указана"}
                              {c.age
                                ? ` · ${c.age} ${plural(c.age, ["год", "года", "лет"])}`
                                : ""}
                            </p>
                          </div>
                        </div>
                        {c.salary_expectation ? (
                          <p className="mt-3 truncate text-xs text-muted-foreground">
                            Ожидания: {c.salary_expectation}
                          </p>
                        ) : null}
                        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>{dateLabel(c.submitted_at)}</span>
                          {c.responsible_id ? (
                            <span className="truncate">
                              {options.members
                                .find((m) => m.id === c.responsible_id)
                                ?.name.split(" ")[0] ?? "Ответственный"}
                            </span>
                          ) : null}
                        </div>
                      </Link>
                    ))}
                </div>
              </section>
            ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                {[
                  "Кандидат",
                  "Должность",
                  "Статус",
                  "Телефон",
                  "Дата заявки",
                  "Ответственный",
                ].map((l) => (
                  <th
                    key={l}
                    className="whitespace-nowrap px-4 py-3 font-medium"
                  >
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((c) => (
                <tr key={c.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link
                      className="font-medium hover:text-brand"
                      href={`/people/candidates/${c.id}`}
                    >
                      {c.full_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{c.desired_position ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      className={STATUS_CLASSES[c.status]}
                      label={STATUSES[c.status]}
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {c.phone ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {dateLabel(c.submitted_at)}
                  </td>
                  <td className="px-4 py-3">
                    {options.members.find((m) => m.id === c.responsible_id)
                      ?.name ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating ? (
        <CandidateForm
          onClose={() => setCreating(false)}
          onSaved={(id) => router.push(`/people/candidates/${id}`)}
        />
      ) : null}
      {settings ? (
        <RecruitingSettings
          options={options}
          onClose={() => setSettings(false)}
        />
      ) : null}
    </div>
  );
}

"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import {
  LayoutGrid,
  List,
  Settings2,
  Archive,
  ArrowLeft,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TablePageHeader, TableControls } from "@/components/shared/table";
import { DateRangeFilter } from "@/components/shared/date-range-filter";
import { format } from "date-fns";
import { candidateError } from "@/lib/candidates/errors";
import {
  CANDIDATE_STAGES,
  STATUSES,
  STATUS_CLASSES,
  type Candidate,
  type CandidatePermissions,
  type HiringOptions,
} from "@/lib/candidates/types";
import { listCandidates, updateCandidate } from "../actions";
import { FieldSelect, StatusBadge, dateLabel, plural } from "./fields";
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
  const [data, setData] = useState(initial),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [position, setPosition] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [page, setPage] = useState(0),
    [view, setView] = useState<"board" | "table">("board"),
    [searchOpen, setSearchOpen] = useState(false),
    [preset, setPreset] = useState<string | null>(null),
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
            candidateError(
              e,
              "Не удалось загрузить анкеты. Повторите попытку.",
            ),
          );
      }
    });
    return () => {
      active = false;
    };
  }, [query, status, position, from, to, archive, page]);
  const refresh = async () =>
    setData(
      await listCandidates({
        search: query,
        status,
        position,
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
        toast.error(candidateError(e, "Не удалось сменить статус"));
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
          </>
        }
      />
      <div className="grid gap-3 lg:flex lg:flex-wrap lg:items-center lg:justify-between">
        <DateRangeFilter
          ariaLabel="Дата заявки"
          value={{
            start: from ? new Date(`${from}T12:00:00`) : null,
            end: to ? new Date(`${to}T12:00:00`) : null,
          }}
          presetLabel={preset}
          onChange={(range, label) => {
            setFrom(range.start ? format(range.start, "yyyy-MM-dd") : "");
            setTo(range.end ? format(range.end, "yyyy-MM-dd") : "");
            setPreset(label);
            setPage(0);
          }}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <TableControls
            search={{
              value: search,
              onChange: setSearch,
              open: searchOpen,
              onOpenChange: setSearchOpen,
              placeholder: "Имя, телефон или должность",
            }}
            filters={{
              active: !!(status || position),
              content: (
                <div className="w-72 space-y-4 p-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-medium">Фильтры</h2>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setStatus("");
                        setPosition("");
                        setPage(0);
                      }}
                    >
                      Сбросить
                    </Button>
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
                      ...Object.entries(CANDIDATE_STAGES).map(
                        ([value, label]) => ({ value, label }),
                      ),
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
                </div>
              ),
            }}
          />
          <div className="flex gap-1" aria-label="Вид списка">
            <Button
              variant={view === "board" ? "secondary" : "ghost"}
              size="icon"
              className="size-9"
              aria-label="Доска"
              aria-pressed={view === "board"}
              onClick={() => setView("board")}
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              variant={view === "table" ? "secondary" : "ghost"}
              size="icon"
              className="size-9"
              aria-label="Таблица"
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
            >
              <List className="size-4" />
            </Button>
          </div>
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
            {query || status || position || from || to
              ? "По этим условиям анкет нет"
              : archive
                ? "Архив пуст"
                : "Пока нет кандидатов"}
          </h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            {archive
              ? "Архивированные анкеты появятся здесь."
              : query || status || position || from || to
                ? "Измените поиск или сбросьте фильтры."
                : "Новые анкеты появятся здесь после отправки формы на сайте."}
          </p>
        </div>
      ) : view === "board" ? (
        <div className="flex min-w-0 gap-4 overflow-x-auto pb-4">
          {Object.entries(CANDIDATE_STAGES)
            .filter(([key]) => !status || key === status)
            .map(([key, label]) => (
              <section
                key={key}
                aria-label={label}
                className="w-72 shrink-0 rounded-xl bg-muted/40 p-3"
                onDragOver={(e) => {
                  if (permissions.manage && !archive) e.preventDefault();
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {settings ? (
        <RecruitingSettings
          options={options}
          owner={permissions.owner}
          onClose={() => setSettings(false)}
        />
      ) : null}
    </div>
  );
}

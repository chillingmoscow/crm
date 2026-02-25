"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Building2,
  LayoutGrid,
  Maximize2,
  Pencil,
  Plus,
  RotateCw,
  Save,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createDemoHall,
  deleteDemoHall,
  getDemoHallLayout,
  renameDemoHall,
  saveDemoHallLayout,
  type Hall,
  type HallLayout,
  type PlanObject,
} from "../actions";

const DEFAULT_CANVAS_WIDTH = 1200;
const DEFAULT_CANVAS_HEIGHT = 760;
const MIN_TABLE_SIZE = 72;
const MIN_PARTITION_HEIGHT = 10;
const MIN_PARTITION_WIDTH = 40;
const ROTATION_SNAP_THRESHOLD = 6;
const DRAFT_PREFIX = "planner:draft:";

type HallDraft = Pick<
  HallLayout,
  "hall_id" | "canvas_width" | "canvas_height" | "objects"
> & {
  saved_at: string;
};

type Interaction =
  | {
      mode: "drag";
      objectId: string;
      startX: number;
      startY: number;
      initialX: number;
      initialY: number;
    }
  | {
      mode: "resize";
      objectId: string;
      startX: number;
      startY: number;
      initialWidth: number;
      initialHeight: number;
      minWidth: number;
      minHeight: number;
    }
  | {
      mode: "rotate";
      objectId: string;
      centerX: number;
      centerY: number;
      pointerAngleOffset: number;
    };

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeAngle(value: number) {
  let angle = value % 360;
  if (angle < 0) angle += 360;
  return angle;
}

function snapToRightAngles(angle: number): { angle: number; snapped: boolean } {
  const normalized = normalizeAngle(angle);
  const targets = [0, 90, 180, 270, 360];

  for (const target of targets) {
    const effectiveTarget = target === 360 ? 0 : target;
    const diff = Math.min(
      Math.abs(normalized - target),
      Math.abs(normalized - effectiveTarget)
    );
    if (diff <= ROTATION_SNAP_THRESHOLD) {
      return { angle: effectiveTarget, snapped: true };
    }
  }

  return {
    angle: Math.round(normalized),
    snapped: false,
  };
}

function createObject(kind: "table" | "partition", shape: "rect" | "circle"): PlanObject {
  return {
    id: uid(),
    kind,
    shape,
    x: 120,
    y: 120,
    width: kind === "partition" ? 240 : 100,
    height: kind === "partition" ? 10 : 100,
    rotation: 0,
    table_number: kind === "table" ? String(Math.floor(Math.random() * 90) + 10) : undefined,
    capacity: kind === "table" ? 4 : undefined,
  };
}

function objectLabel(object: PlanObject) {
  if (object.kind === "partition") return "Перегородка";
  if (object.shape === "circle") return "Круглый стол";
  return "Прямоугольный стол";
}

function defaultLayout(hallId: string): HallLayout {
  return {
    hall_id: hallId,
    canvas_width: DEFAULT_CANVAS_WIDTH,
    canvas_height: DEFAULT_CANVAS_HEIGHT,
    objects: [],
    updated_at: new Date().toISOString(),
  };
}

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

function draftKey(hallId: string) {
  return `${DRAFT_PREFIX}${hallId}`;
}

function parseDraft(raw: string | null, hallId: string): HallDraft | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<HallDraft>;
    if (
      parsed.hall_id !== hallId ||
      typeof parsed.canvas_width !== "number" ||
      typeof parsed.canvas_height !== "number" ||
      !Array.isArray(parsed.objects) ||
      typeof parsed.saved_at !== "string"
    ) {
      return null;
    }

    return {
      hall_id: parsed.hall_id,
      canvas_width: parsed.canvas_width,
      canvas_height: parsed.canvas_height,
      objects: parsed.objects as PlanObject[],
      saved_at: parsed.saved_at,
    };
  } catch {
    return null;
  }
}

type Props = {
  initialHalls: Hall[];
  initialHallId: string | null;
  initialLayout: HallLayout | null;
};

export function LayoutDemoClient({
  initialHalls,
  initialHallId,
  initialLayout,
}: Props) {
  const [halls, setHalls] = useState(initialHalls);
  const [selectedHallId, setSelectedHallId] = useState<string | null>(initialHallId);
  const [layout, setLayout] = useState<HallLayout | null>(() => {
    if (!initialHallId) return null;
    return initialLayout ?? defaultLayout(initialHallId);
  });
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [rotationSnapActive, setRotationSnapActive] = useState(false);
  const [isPending, startTransition] = useTransition();

  const interactionRef = useRef<Interaction | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLDivElement>(null);

  const selectedObject = useMemo(
    () => layout?.objects.find((item) => item.id === selectedObjectId) ?? null,
    [layout, selectedObjectId]
  );

  const statusText = useMemo(() => {
    if (!selectedHallId) return "Выберите зал";
    if (isDirty && draftSavedAt) return "Черновик локально (есть несохранённые изменения)";
    if (isDirty) return "Есть несохранённые изменения";
    if (draftSavedAt) return "Черновик локально";
    return "Сохранено в БД";
  }, [selectedHallId, isDirty, draftSavedAt]);

  const saveDraftToLocalStorage = (
    hallId: string,
    currentLayout: HallLayout,
    savedAt: string
  ) => {
    const payload: HallDraft = {
      hall_id: hallId,
      canvas_width: currentLayout.canvas_width,
      canvas_height: currentLayout.canvas_height,
      objects: currentLayout.objects,
      saved_at: savedAt,
    };
    localStorage.setItem(draftKey(hallId), JSON.stringify(payload));
  };

  const readDraftFromLocalStorage = (hallId: string): HallDraft | null => {
    const key = draftKey(hallId);
    const parsed = parseDraft(localStorage.getItem(key), hallId);
    if (!parsed) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  };

  const clearDraftFromLocalStorage = (hallId: string) => {
    localStorage.removeItem(draftKey(hallId));
  };

  const resolveHallLayout = async (
    hallId: string,
    preferDraft: boolean
  ): Promise<{ layout: HallLayout; draftAt: string | null; fromDraft: boolean }> => {
    if (preferDraft) {
      const draft = readDraftFromLocalStorage(hallId);
      if (draft) {
        return {
          layout: {
            hall_id: draft.hall_id,
            canvas_width: draft.canvas_width,
            canvas_height: draft.canvas_height,
            objects: draft.objects,
            updated_at: draft.saved_at,
          },
          draftAt: draft.saved_at,
          fromDraft: true,
        };
      }
    }

    const nextLayout = await getDemoHallLayout(hallId);
    return {
      layout: nextLayout ?? defaultLayout(hallId),
      draftAt: null,
      fromDraft: false,
    };
  };

  const mutateObjects = (fn: (current: PlanObject[]) => PlanObject[]) => {
    setLayout((prev) => {
      if (!prev) return prev;
      return { ...prev, objects: fn(prev.objects) };
    });
    setIsDirty(true);
  };

  const updateObject = (id: string, patch: Partial<PlanObject>) => {
    mutateObjects((prev) =>
      prev.map((obj) => (obj.id === id ? { ...obj, ...patch } : obj))
    );
  };

  const loadHallLayout = (hallId: string, preferDraft = true) => {
    startTransition(async () => {
      const next = await resolveHallLayout(hallId, preferDraft);
      setSelectedObjectId(null);
      setLayout(next.layout);
      setSelectedHallId(hallId);
      setIsDirty(next.fromDraft);
      setDraftSavedAt(next.draftAt);
      if (next.fromDraft) {
        toast.info("Восстановлен локальный черновик");
      }
    });
  };

  const persistCurrentDraftNow = () => {
    if (!selectedHallId || !layout || !isDirty) return;
    const now = new Date().toISOString();
    saveDraftToLocalStorage(selectedHallId, layout, now);
    setDraftSavedAt(now);
  };

  const onSelectHall = (hallId: string) => {
    if (hallId === selectedHallId) return;
    if (
      isDirty &&
      !window.confirm("Есть несохранённые изменения. Переключить зал без сохранения?")
    ) {
      return;
    }
    persistCurrentDraftNow();
    loadHallLayout(hallId, true);
  };

  const onCreateHall = () => {
    const hallName = window.prompt("Название нового зала", "Новый зал")?.trim();
    if (!hallName) return;

    persistCurrentDraftNow();

    startTransition(async () => {
      const result = await createDemoHall(hallName);
      if (result.error || !result.hall) {
        toast.error(result.error ?? "Не удалось создать зал");
        return;
      }
      setHalls((prev) => [...prev, result.hall as Hall]);
      setSelectedHallId(result.hall.id);
      setSelectedObjectId(null);
      setLayout(defaultLayout(result.hall.id));
      setIsDirty(false);
      setDraftSavedAt(null);
      toast.success("Зал создан");
    });
  };

  const onRenameHall = () => {
    if (!selectedHallId) return;
    const hall = halls.find((item) => item.id === selectedHallId);
    if (!hall) return;
    const nextName = window.prompt("Новое название зала", hall.name);
    if (!nextName) return;

    startTransition(async () => {
      const result = await renameDemoHall(selectedHallId, nextName);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setHalls((prev) =>
        prev.map((item) =>
          item.id === selectedHallId ? { ...item, name: nextName.trim() } : item
        )
      );
      toast.success("Название обновлено");
    });
  };

  const onDeleteHall = () => {
    if (!selectedHallId) return;
    const hall = halls.find((item) => item.id === selectedHallId);
    if (!hall) return;
    if (!window.confirm(`Удалить зал "${hall.name}"?`)) return;

    startTransition(async () => {
      const deletingId = selectedHallId;
      const result = await deleteDemoHall(deletingId);
      if (result.error) {
        toast.error(result.error);
        return;
      }

      clearDraftFromLocalStorage(deletingId);

      const nextHalls = halls.filter((item) => item.id !== deletingId);
      setHalls(nextHalls);
      const nextSelected = nextHalls[0]?.id ?? null;
      setSelectedHallId(nextSelected);
      setSelectedObjectId(null);
      setDraftSavedAt(null);

      if (!nextSelected) {
        setLayout(null);
        setIsDirty(false);
        toast.success("Зал удалён");
        return;
      }

      const next = await resolveHallLayout(nextSelected, true);
      setLayout(next.layout);
      setIsDirty(next.fromDraft);
      setDraftSavedAt(next.draftAt);
      if (next.fromDraft) {
        toast.info("Восстановлен локальный черновик");
      }
      toast.success("Зал удалён");
    });
  };

  const addObject = (kind: "table" | "partition", shape: "rect" | "circle") => {
    if (!layout) return;
    const object = createObject(kind, shape);
    mutateObjects((prev) => [...prev, object]);
    setSelectedObjectId(object.id);
    setFabOpen(false);
  };

  const onDeleteObject = () => {
    if (!selectedObjectId) return;
    mutateObjects((prev) => prev.filter((item) => item.id !== selectedObjectId));
    setSelectedObjectId(null);
  };

  const onSave = () => {
    if (!selectedHallId || !layout) return;
    startTransition(async () => {
      const result = await saveDemoHallLayout(selectedHallId, {
        canvas_width: layout.canvas_width,
        canvas_height: layout.canvas_height,
        objects: layout.objects,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      clearDraftFromLocalStorage(selectedHallId);
      setLayout((prev) =>
        prev
          ? {
              ...prev,
              updated_at: result.updated_at ?? prev.updated_at,
            }
          : prev
      );
      setIsDirty(false);
      setDraftSavedAt(null);
      toast.success("Схема сохранена");
    });
  };

  const onResetDraft = () => {
    if (!selectedHallId) return;
    if (!window.confirm("Сбросить локальный черновик и загрузить данные из БД?")) {
      return;
    }
    clearDraftFromLocalStorage(selectedHallId);
    setDraftSavedAt(null);
    loadHallLayout(selectedHallId, false);
    toast.success("Локальный черновик удалён");
  };

  const startDrag = (event: React.PointerEvent, object: PlanObject) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedObjectId(object.id);
    interactionRef.current = {
      mode: "drag",
      objectId: object.id,
      startX: event.clientX,
      startY: event.clientY,
      initialX: object.x,
      initialY: object.y,
    };
  };

  const startResize = (event: React.PointerEvent, object: PlanObject) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedObjectId(object.id);
    interactionRef.current = {
      mode: "resize",
      objectId: object.id,
      startX: event.clientX,
      startY: event.clientY,
      initialWidth: object.width,
      initialHeight: object.height,
      minWidth: object.kind === "partition" ? MIN_PARTITION_WIDTH : MIN_TABLE_SIZE,
      minHeight: object.kind === "partition" ? MIN_PARTITION_HEIGHT : MIN_TABLE_SIZE,
    };
  };

  const startRotate = (event: React.PointerEvent, object: PlanObject) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canvasRef.current) return;
    setSelectedObjectId(object.id);
    const bounds = canvasRef.current.getBoundingClientRect();
    const centerX = bounds.left + object.x + object.width / 2;
    const centerY = bounds.top + object.y + object.height / 2;
    const pointerAngle =
      (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) /
      Math.PI;
    interactionRef.current = {
      mode: "rotate",
      objectId: object.id,
      centerX,
      centerY,
      pointerAngleOffset: pointerAngle - object.rotation,
    };
  };

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const current = interactionRef.current;
      if (!current) return;

      setIsDirty(true);

      if (current.mode === "drag") {
        setRotationSnapActive(false);
        const nextX = current.initialX + (event.clientX - current.startX);
        const nextY = current.initialY + (event.clientY - current.startY);
        setLayout((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            objects: prev.objects.map((obj) =>
              obj.id === current.objectId
                ? { ...obj, x: Math.round(nextX), y: Math.round(nextY) }
                : obj
            ),
          };
        });
        return;
      }

      if (current.mode === "resize") {
        setRotationSnapActive(false);
        const width = Math.max(
          current.minWidth,
          current.initialWidth + (event.clientX - current.startX)
        );
        const height = Math.max(
          current.minHeight,
          current.initialHeight + (event.clientY - current.startY)
        );
        setLayout((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            objects: prev.objects.map((obj) =>
              obj.id === current.objectId
                ? {
                    ...obj,
                    width: Math.round(width),
                    height: Math.round(height),
                  }
                : obj
            ),
          };
        });
        return;
      }

      const pointerAngle =
        (Math.atan2(
          event.clientY - current.centerY,
          event.clientX - current.centerX
        ) *
          180) /
        Math.PI;
      const nextAngle = snapToRightAngles(
        pointerAngle - current.pointerAngleOffset
      );
      setRotationSnapActive(nextAngle.snapped);
      setLayout((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          objects: prev.objects.map((obj) =>
            obj.id === current.objectId
              ? { ...obj, rotation: nextAngle.angle }
              : obj
          ),
        };
      });
    };

    const onPointerUp = () => {
      if (interactionRef.current) {
        interactionRef.current = null;
      }
      setRotationSnapActive(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!fabRef.current) return;
      if (!fabRef.current.contains(event.target as Node)) {
        setFabOpen(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    if (!selectedHallId || !layout || !isDirty) return;

    const timer = window.setTimeout(() => {
      const savedAt = new Date().toISOString();
      saveDraftToLocalStorage(selectedHallId, layout, savedAt);
      setDraftSavedAt(savedAt);
    }, 800);

    return () => window.clearTimeout(timer);
  }, [selectedHallId, layout, isDirty]);

  useEffect(() => {
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setInspectorOpen(false);
      }
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, []);

  return (
    <div className="min-h-screen bg-muted/20 text-foreground">
      <div className="grid min-h-screen md:grid-cols-[220px_1fr]">
        <aside className="hidden md:flex flex-col border-r bg-background/90">
          <div className="h-14 px-4 flex items-center gap-2 border-b">
            <LayoutGrid className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">CRM Demo Shell</span>
          </div>
          <div className="p-3 space-y-1">
            <div className="px-3 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground">
              Планировщик залов
            </div>
            <div className="px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted">
              Сотрудники (demo)
            </div>
            <div className="px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted">
              Уведомления (demo)
            </div>
            <div className="px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted">
              Отчёты (demo)
            </div>
          </div>
          <div className="mt-auto p-3 border-t text-xs text-muted-foreground">
            Навигация демонстрационная
          </div>
        </aside>

        <div className="min-w-0 flex flex-col">
          <header className="h-14 px-4 border-b bg-background/80 backdrop-blur flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
              <h1 className="text-sm md:text-base font-semibold truncate">
                План зала и столы (Demo)
              </h1>
            </div>
            <div className="text-xs text-muted-foreground hidden sm:block">{statusText}</div>
          </header>

          <main className="p-4 md:p-5 flex-1 min-h-0">
            <Card className="p-3 md:p-4 mb-3">
              <div className="flex flex-wrap items-center gap-2 md:gap-2.5">
                <div className="min-w-[220px] flex-1 max-w-[360px]">
                  <Select
                    value={selectedHallId ?? ""}
                    onValueChange={(value) => onSelectHall(value)}
                    disabled={isPending || halls.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите зал" />
                    </SelectTrigger>
                    <SelectContent>
                      {halls.map((hall) => (
                        <SelectItem key={hall.id} value={hall.id}>
                          {hall.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button size="sm" variant="outline" onClick={onCreateHall} disabled={isPending}>
                  <Plus className="w-4 h-4 mr-1.5" />
                  Зал
                </Button>
                <Button size="sm" variant="outline" onClick={onRenameHall} disabled={isPending || !selectedHallId}>
                  <Pencil className="w-4 h-4 mr-1.5" />
                  Переименовать
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={onDeleteHall}
                  disabled={isPending || !selectedHallId}
                >
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  Удалить
                </Button>

                <Separator orientation="vertical" className="h-6 hidden md:block" />

                <div className="ml-auto flex items-center gap-2">
                  <Button
                    onClick={onResetDraft}
                    size="sm"
                    variant="outline"
                    disabled={isPending || !selectedHallId || !draftSavedAt}
                  >
                    Сбросить черновик
                  </Button>
                  <Button
                    onClick={onSave}
                    size="sm"
                    disabled={isPending || !selectedHallId || !isDirty}
                  >
                    <Save className="w-4 h-4 mr-1.5" />
                    Сохранить
                  </Button>
                </div>
              </div>
            </Card>

            <Card className="p-3 md:p-4 h-[calc(100vh-170px)] min-h-[680px] relative overflow-hidden">
              {!layout ? (
                <div className="rounded-md border border-dashed h-full flex items-center justify-center text-muted-foreground text-sm">
                  Создайте зал, чтобы начать
                </div>
              ) : (
                <div
                  ref={canvasRef}
                  className="relative rounded-md border bg-muted/20 h-full w-full overflow-hidden"
                  style={{
                    backgroundImage:
                      "linear-gradient(rgba(15,23,42,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.08) 1px, transparent 1px)",
                    backgroundSize: "24px 24px",
                  }}
                  onPointerDown={(event) => {
                    if (event.target === event.currentTarget) {
                      setSelectedObjectId(null);
                      setFabOpen(false);
                    }
                  }}
                >
                  {selectedObject && (
                    <>
                      <div
                        className={`absolute top-0 bottom-0 border-l border-dashed pointer-events-none ${
                          rotationSnapActive ? "border-emerald-500" : "border-blue-300"
                        }`}
                        style={{ left: selectedObject.x + selectedObject.width / 2 }}
                      />
                      <div
                        className={`absolute left-0 right-0 border-t border-dashed pointer-events-none ${
                          rotationSnapActive ? "border-emerald-500" : "border-blue-300"
                        }`}
                        style={{ top: selectedObject.y + selectedObject.height / 2 }}
                      />
                    </>
                  )}

                  {layout.objects.map((object) => {
                    const selected = selectedObjectId === object.id;
                    const isCircle = object.shape === "circle";
                    const isPartition = object.kind === "partition";

                    return (
                      <div
                        key={object.id}
                        className="absolute touch-none select-none"
                        style={{
                          left: object.x,
                          top: object.y,
                          width: object.width,
                          height: object.height,
                        }}
                        onPointerDown={(event) => startDrag(event, object)}
                      >
                        <div
                          className={`absolute inset-0 border-2 ${
                            isPartition
                              ? "bg-zinc-300/70 border-zinc-500"
                              : "bg-background border-primary/80"
                          } ${isCircle ? "rounded-full" : "rounded-md"}`}
                          style={{
                            transform: `rotate(${object.rotation}deg)`,
                            transformOrigin: "center center",
                          }}
                        />

                        {object.kind === "table" && (
                          <div className="absolute inset-0 flex items-center justify-center text-xs font-medium pointer-events-none">
                            #{object.table_number || "?"}
                          </div>
                        )}

                        {selected && (
                          <>
                            <div
                              className="absolute -inset-1 border border-blue-500 rounded pointer-events-none"
                              style={{
                                transform: `rotate(${object.rotation}deg)`,
                                transformOrigin: "center center",
                              }}
                            />
                            <button
                              type="button"
                              className="absolute -right-2.5 -bottom-2.5 w-7 h-7 rounded-full bg-blue-600 border-2 border-white text-white flex items-center justify-center shadow"
                              onPointerDown={(event) => startResize(event, object)}
                              aria-label="Resize"
                            >
                              <Maximize2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              className={`absolute left-1/2 -translate-x-1/2 -top-9 w-7 h-7 rounded-full border-2 border-white text-white flex items-center justify-center shadow ${
                                rotationSnapActive ? "bg-emerald-600" : "bg-amber-500"
                              }`}
                              onPointerDown={(event) => startRotate(event, object)}
                              aria-label="Rotate"
                            >
                              <RotateCw className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {layout && (
                <div
                  ref={fabRef}
                  className="absolute bottom-10 right-10 z-20 flex flex-col items-end gap-3"
                >
                  {selectedObject && (
                    <Button
                      size="icon"
                      className="h-16 w-16 rounded-full shadow-xl"
                      variant="secondary"
                      onClick={() => setInspectorOpen(true)}
                      aria-label="Настройки объекта"
                    >
                      <Settings2 className="w-7 h-7" />
                    </Button>
                  )}

                  {fabOpen && (
                    <div className="flex flex-col items-end gap-2">
                      <Button
                        size="sm"
                        className="shadow-lg"
                        variant="secondary"
                        onClick={() => addObject("table", "circle")}
                        disabled={isPending}
                      >
                        Круглый стол
                      </Button>
                      <Button
                        size="sm"
                        className="shadow-lg"
                        variant="secondary"
                        onClick={() => addObject("table", "rect")}
                        disabled={isPending}
                      >
                        Прямоугольный стол
                      </Button>
                      <Button
                        size="sm"
                        className="shadow-lg"
                        variant="secondary"
                        onClick={() => addObject("partition", "rect")}
                        disabled={isPending}
                      >
                        Перегородка
                      </Button>
                    </div>
                  )}

                  <Button
                    size="icon"
                    className="h-16 w-16 rounded-full shadow-xl"
                    onClick={() => setFabOpen((v) => !v)}
                    aria-label="Добавить объект"
                  >
                    <Plus className={`w-7 h-7 transition-transform ${fabOpen ? "rotate-45" : ""}`} />
                  </Button>
                </div>
              )}
            </Card>
          </main>
        </div>
      </div>

      {inspectorOpen && (
        <div
          className="fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label="Инспектор объекта"
        >
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setInspectorOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-full sm:w-[380px] bg-background border-l shadow-xl overflow-y-auto">
            <div className="h-14 border-b px-4 flex items-center justify-between">
              <h2 className="font-semibold text-sm">Инспектор</h2>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setInspectorOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="p-4">
              {!selectedObject ? (
                <p className="text-sm text-muted-foreground">Выберите объект на схеме.</p>
              ) : (
                <div className="space-y-3">
                  <div>
                    <Label>Тип</Label>
                    <Input
                      value={objectLabel(selectedObject)}
                      readOnly
                      className="mt-1 bg-muted/50"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="obj-w">W</Label>
                      <Input
                        id="obj-w"
                        value={String(selectedObject.width)}
                        onChange={(event) =>
                          updateObject(selectedObject.id, {
                            width: Math.max(
                              selectedObject.kind === "partition"
                                ? MIN_PARTITION_WIDTH
                                : MIN_TABLE_SIZE,
                              toNumber(event.target.value, selectedObject.width)
                            ),
                          })
                        }
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="obj-h">H</Label>
                      <Input
                        id="obj-h"
                        value={String(selectedObject.height)}
                        onChange={(event) =>
                          updateObject(selectedObject.id, {
                            height: Math.max(
                              selectedObject.kind === "partition"
                                ? MIN_PARTITION_HEIGHT
                                : MIN_TABLE_SIZE,
                              toNumber(event.target.value, selectedObject.height)
                            ),
                          })
                        }
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="obj-rotation">Rotation</Label>
                    <Input
                      id="obj-rotation"
                      value={String(selectedObject.rotation)}
                      onChange={(event) =>
                        updateObject(selectedObject.id, {
                          rotation: normalizeAngle(
                            toNumber(event.target.value, selectedObject.rotation)
                          ),
                        })
                      }
                      className="mt-1"
                    />
                  </div>

                  {selectedObject.kind === "table" && (
                    <>
                      <div>
                        <Label htmlFor="obj-number">Номер стола</Label>
                        <Input
                          id="obj-number"
                          value={selectedObject.table_number ?? ""}
                          onChange={(event) =>
                            updateObject(selectedObject.id, { table_number: event.target.value })
                          }
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="obj-capacity">Вместимость</Label>
                        <Input
                          id="obj-capacity"
                          value={String(selectedObject.capacity ?? 0)}
                          onChange={(event) =>
                            updateObject(selectedObject.id, {
                              capacity: Math.max(
                                0,
                                toNumber(event.target.value, selectedObject.capacity ?? 0)
                              ),
                            })
                          }
                          className="mt-1"
                        />
                      </div>
                    </>
                  )}

                  <Separator />

                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    onClick={onDeleteObject}
                  >
                    <Trash2 className="w-4 h-4 mr-1.5" />
                    Удалить объект
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

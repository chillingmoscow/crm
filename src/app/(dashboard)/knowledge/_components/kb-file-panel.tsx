"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { CloudUpload } from "lucide-react";
import { filenameFromURL } from "@blocknote/core";
import {
  type FilePanelProps,
  useBlockNoteEditor,
} from "@blocknote/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  KNOWLEDGE_FILE_FORMAT_HINT,
  validateKnowledgeFile,
} from "@/lib/knowledge/media-file-validation";
import {
  finishUpload,
  startUpload,
} from "@/app/(dashboard)/knowledge/_components/kb-upload-queue-store";

/**
 * Custom replacement для BN-default'ного `FilePanel`. Появляется как
 * popover при добавлении image / video / audio / file блока (см.
 * sheerly.pen frame 13 · JXSyX и frame 13b · rNEwo для видео).
 *
 * 2 таба:
 *   1. **Загрузить** — drop-zone с cloud-upload иконкой, click-to-pick
 *      fallback'ом, hint'ом по форматам/размеру. Принимает drag&drop.
 *   2. **Вставить** — input для URL + Submit-кнопка + hint про
 *      поддерживаемые сервисы.
 *
 * Stand-alone дизайн — не наследует BN-shadcn'овский Tabs/Card,
 * чтобы можно было полностью контролировать padding, тени, анимации
 * под наш DS. Подключается через
 * `<FilePanelController filePanel={KbFilePanel} />`.
 */
export type KbFilePanelProps = FilePanelProps & {
  /** Callback закрывает popover (replace flow — controlled Radix Popover
   *  в KbFileReplaceButton). Если не передан — KbFilePanel закрывает
   *  себя через FilePanelExtension.closeMenu (BN-default flow для empty
   *  media-блоков, открывается через FilePanelController). */
  onClose?: () => void;
};

export function KbFilePanel(props: KbFilePanelProps) {
  // any-generic'и идиоматичны для BN-extension'ов (см. kb-side-menu).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useBlockNoteEditor<any, any, any>();
  const block = editor.getBlock(props.blockId);
  const [tab, setTab] = useState<"upload" | "embed">(
    editor.uploadFile ? "upload" : "embed",
  );

  // BN передаёт blockId, но в момент closeMenu блок может быть удалён —
  // защита от null'а.
  if (!block) return null;

  // Универсальный close с ownership-check'ом (Codex P2 на PR #157):
  //   • replace-flow → props.onClose = setOpen(false), scoped к
  //     КОНКРЕТНОМУ Radix Popover instance'у (наш KbFileReplaceButton);
  //     зовём как есть, на чужие panel'и не повлияет.
  //   • add-flow → FilePanelExtension.closeMenu, но ТОЛЬКО если
  //     активный blockId совпадает с нашим props.blockId. Иначе юзер
  //     уже открыл panel B для другого блока, и наш close был бы
  //     ошибочным.
  const close = () => {
    if (props.onClose) {
      props.onClose();
      return;
    }
    try {
      const ext = editor.extensions?.get?.("filePanel") as
        | { closeMenu?: () => void; store?: { state?: string } }
        | undefined;
      if (ext?.store?.state === props.blockId) {
        ext?.closeMenu?.();
      }
    } catch {
      // Defensive: API change → silently skip; BN auto-closes on
      // updateBlock через editor.onChange, так что panel всё равно
      // закроется чуть позже.
    }
  };
  return (
    <div className="kb-file-panel">
      <div className="kb-file-panel-tabs" role="tablist">
        {editor.uploadFile && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "upload"}
            data-active={tab === "upload" || undefined}
            onClick={() => setTab("upload")}
            className="kb-file-panel-tab"
          >
            Загрузить
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={tab === "embed"}
          data-active={tab === "embed" || undefined}
          onClick={() => setTab("embed")}
          className="kb-file-panel-tab"
        >
          Вставить
        </button>
      </div>

      {tab === "upload" && editor.uploadFile && (
        <UploadPanel
          blockId={props.blockId}
          blockType={block.type}
          onClose={close}
        />
      )}
      {tab === "embed" && (
        <EmbedPanel
          blockId={props.blockId}
          blockType={block.type}
          onClose={close}
        />
      )}
    </div>
  );
}

// ─── Upload tab ─────────────────────────────────────────────────────

/** Хинты для drop-zone'ы. Список форматов синхронен с MIME_PATTERNS
 *  ниже (валидация в pre-flight). */
const UPLOAD_TITLE: Record<string, string> = {
  video: "Перетащите видео сюда",
  image: "Перетащите картинку сюда",
  audio: "Перетащите аудио сюда",
  file: "Перетащите файл сюда",
};

function UploadPanel({
  blockType,
  blockId,
  onClose,
}: FilePanelProps & { blockType: string; onClose: () => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useBlockNoteEditor<any, any, any>();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 5-сек auto-clear ошибки. Длиннее чем у BN (3 сек) — даём юзеру
  // прочитать причину (особенно «формат не поддерживается» с длинным
  // списком).
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  // Upload — fire-and-forget после pre-flight'а. Юзер-фидбек на PR
  // #153: «загрузка по-прежнему происходит только с второго раза» —
  // queueMicrotask-фикс из #151 не помог. Гипотеза: при OS-file-picker'е
  // фокус на короткое время уходит на dialog → BN-овский floating-ui
  // useDismiss срабатывает на focus-out (или onSelectionChange), и
  // popover уходит в close-transition → GenericPopover (см. node_modules/
  //   .../Popovers/GenericPopover.tsx) подменяет React-children на
  // dangerouslySetInnerHTML, ОТРЫВАЯ `<input>`-элемент от React-fiber'а.
  // input.onChange всё ещё фаерится (DOM-event'ом), но React-handler
  // уже не привязан → upload() не зовётся.
  //
  // Workaround: НЕ закрываем panel вручную. Дожидаемся upload-success,
  // делаем editor.updateBlock — он автоматически триггерит onChange,
  // и FilePanelExtension сам закрывает panel (см. node_modules/.../
  //   FilePanel/FilePanel.ts: editor.onChange(closeMenu)). То же
  // поведение что у BN-default'ной UploadTab. Trade-off: panel виден
  // во время upload'а (раньше скрывался сразу) — но pre-flight
  // mp3-фикса требовал работающий первый upload, без него UX-приоритеты
  // вторичны.
  //
  // Для replace-flow (KbFileReplaceButton) — там Radix Popover, не
  // BN-store, у нас сами должны закрывать. KbFileReplaceButton передаёт
  // onClose, и ОН будет дёрнут после updateBlock (см. ниже).
  const upload = useCallback(
    (file: File) => {
      if (!editor.uploadFile) return;

      const validationError = validateKnowledgeFile(file, blockType);
      if (validationError) {
        setError(validationError);
        return;
      }

      startUpload(blockId, file.name);

      void (async () => {
        // Initiate server-action синхронно (sync-часть editor.uploadFile
        // запускает запрос). С этого момента запрос in-flight и не
        // отменится при unmount'е panel'а.
        const uploadPromise = editor.uploadFile!(file, blockId);

        // Defer close: setTimeout(0) — следующий macrotask, после того
        // как React-event tick + все микротаски обработаны и BN-store
        // стабильно. Юзер-фидбек на PR #157: если closeMenu срабатывал
        // СИНХРОННО или через queueMicrotask, OS-file-picker'овский
        // change-event попадал на детач'ивший popover (close-transition
        // подменяет children на dangerouslySetInnerHTML), и upload не
        // запускался. setTimeout 0ms даёт браузеру dispatch'нуть
        // change-event и нашу handleChange до closeMenu.
        // onClose с ownership-проверкой в KbFilePanel — не закроет
        // чужую panel.
        setTimeout(onClose, 0);

        try {
          let updateData = await uploadPromise;
          if (typeof updateData === "string") {
            updateData = {
              props: { name: file.name, url: updateData },
            };
          }
          editor.updateBlock(blockId, updateData);
        } catch (e) {
          // Surface real message: Supabase / RLS / size errors → юзер
          // увидит конкретную причину, а не generic «не удалось».
          // Pool-timeout — типичная проблема self-hosted Supabase под
          // нагрузкой (юзер-фидбек на PR #159: 950КБ грузилось 30с,
          // потом «Timed out acquiring connection from connection
          // pool»). Подменяем на user-friendly текст.
          const raw = e instanceof Error ? e.message : "Не удалось загрузить файл";
          const friendly = /connection pool|timed out acquiring/i.test(raw)
            ? "Сервер сейчас перегружен (connection pool). Попробуйте ещё раз через минуту."
            : raw;
          alert(`Ошибка загрузки: ${friendly}`);
        } finally {
          finishUpload(blockId);
        }
      })();
    },
    [editor, blockId, blockType, onClose],
  );

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) upload(f);
    // Reset input.value: позволяет повторно выбрать тот же файл (без
    // этого браузер не файрит change на одинаковом file pick).
    e.target.value = "";
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) upload(f);
  };

  // accept attribute из BN-spec'а блока — то же что BN использует
  // в default UploadTab.
  const spec = editor.schema.blockSpecs[blockType];
  const accept = spec?.implementation.meta?.fileBlockAccept?.length
    ? spec.implementation.meta.fileBlockAccept.join(",")
    : "*/*";

  return (
    <div className="kb-file-panel-body">
      <div
        className={cn("kb-file-panel-dropzone", dragOver && "is-dragover")}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <CloudUpload className="size-7 text-muted-foreground" />
        <div className="kb-file-panel-dropzone-title">
          {UPLOAD_TITLE[blockType] ?? UPLOAD_TITLE.file}
        </div>
        <div className="kb-file-panel-dropzone-sub">
          или нажмите, чтобы выбрать файл
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={onChange}
          className="sr-only"
          // Ловим click отдельно через onClick wrapper'а (open native
          // file-picker без двойного триггера).
          aria-hidden
          tabIndex={-1}
        />
      </div>
      <div className="kb-file-panel-hint">
        {KNOWLEDGE_FILE_FORMAT_HINT[blockType] ?? KNOWLEDGE_FILE_FORMAT_HINT.file}
      </div>
      {error && <div className="kb-file-panel-error">{error}</div>}
    </div>
  );
}

// ─── Embed tab ──────────────────────────────────────────────────────

const EMBED_PLACEHOLDER: Record<string, string> = {
  video: "Вставьте ссылку: YouTube, Vimeo, MP4…",
  image: "Вставьте ссылку на картинку",
  audio: "Вставьте ссылку на аудио",
  file: "Вставьте ссылку на файл",
};

const EMBED_BTN: Record<string, string> = {
  video: "Вставить видео",
  image: "Вставить картинку",
  audio: "Вставить аудио",
  file: "Вставить файл",
};

const EMBED_HINT: Record<string, string> = {
  video:
    "Поддерживаются YouTube, Vimeo, Loom, Vidyard и прямые ссылки на .mp4/.webm",
  image: "Прямая ссылка на изображение (JPG, PNG, GIF, WEBP)",
  audio: "Прямая ссылка на аудио (MP3, WAV, OGG, M4A)",
  file: "Прямая ссылка на файл",
};

function EmbedPanel({
  blockType,
  blockId,
  onClose,
}: FilePanelProps & { blockType: string; onClose: () => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useBlockNoteEditor<any, any, any>();
  const [url, setUrl] = useState("");

  const submit = () => {
    if (!url.trim()) return;
    editor.updateBlock(blockId, {
      props: { name: filenameFromURL(url), url },
    });
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="kb-file-panel-body">
      <Input
        type="url"
        placeholder={EMBED_PLACEHOLDER[blockType] ?? EMBED_PLACEHOLDER.file}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
        className="h-10"
      />
      <div className="flex justify-end">
        <Button
          type="button"
          onClick={submit}
          disabled={!url.trim()}
          size="sm"
        >
          {EMBED_BTN[blockType] ?? EMBED_BTN.file}
        </Button>
      </div>
      <div className="kb-file-panel-hint kb-file-panel-hint-multiline">
        {EMBED_HINT[blockType] ?? EMBED_HINT.file}
      </div>
    </div>
  );
}

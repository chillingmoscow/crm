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
   *  в KbFileReplaceButton). Если не передан — KbFilePanel закрывает себя
   *  через FilePanelExtension.closeMenu (BN-default flow для empty media-
   *  блоков, открывается через FilePanelController). */
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

  // Универсальный close: replace flow → setOpen(false) (controlled Radix
  // Popover); empty-state add flow → FilePanelExtension.closeMenu()
  // (показ панели завязан на blockId-state экстеншена, blur'ом не
  // закрыть, см. node_modules/.../FilePanelController.tsx).
  const close = () => {
    if (props.onClose) {
      props.onClose();
      return;
    }
    try {
      const ext = editor.extensions?.get?.("filePanel") as
        | { closeMenu?: () => void }
        | undefined;
      ext?.closeMenu?.();
    } catch {
      // Defensive: если API изменится — silently ignore, юзер сам
      // переключится с блока (selection deselect → BN сам закроет).
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

const FORMAT_HINT: Record<string, string> = {
  video: "MP4, MOV, WebM · до 50 МБ",
  image: "PNG, JPG, GIF, WEBP · до 10 МБ",
  // MP3 (audio/mpeg) НЕ принимается storage-bucket'ом по фидбеку юзера
  // (#147) — конкретный mp3 не грузился, а ogg / m4a проходили. Указываем
  // только проверенные форматы; mp3 не пишем во избежание confusion'а.
  audio: "WAV, OGG, M4A · до 50 МБ",
  file: "Любой файл · до 50 МБ",
};

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

  // 3-сек auto-clear ошибки (как в BN-default'е).
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(t);
  }, [error]);

  // Upload — fire-and-forget: регистрируем в kb-upload-queue-store, сразу
  // закрываем panel через onClose (FilePanelExtension.closeMenu для add
  // flow или setOpen(false) для replace flow), запускаем editor.uploadFile
  // в фоне. Юзер сразу возвращается к editing — overlay с прогрессом
  // отрисуется в блоке (см. KbUploadProgressOverlay).
  const upload = useCallback(
    (file: File) => {
      if (!editor.uploadFile) return;
      startUpload(blockId, file.name);
      onClose();

      void (async () => {
        try {
          let updateData = await editor.uploadFile!(file, blockId);
          if (typeof updateData === "string") {
            updateData = {
              props: { name: file.name, url: updateData },
            };
          }
          editor.updateBlock(blockId, updateData);
        } catch (e) {
          // Ошибка попадает уже после закрытия panel'а — показываем её
          // в сторонней form'е нельзя, поэтому fallback'имся на alert.
          // Лучше чем тихий fail (юзер видит заглушку "Загрузить файл"
          // и не понимает что произошло).
          const msg = e instanceof Error ? e.message : "Не удалось загрузить файл";
          alert(msg);
        } finally {
          finishUpload(blockId);
        }
      })();
    },
    [editor, blockId, onClose],
  );

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) upload(f);
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
        {FORMAT_HINT[blockType] ?? FORMAT_HINT.file}
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
  audio: "Прямая ссылка на аудио (MP3, WAV, OGG)",
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

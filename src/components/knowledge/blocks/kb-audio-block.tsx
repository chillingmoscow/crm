/**
 * Custom KB audio block — заменяет BN-default'ный `audio` чтобы:
 *   1. Подменить ugly react-icons RiVolumeUpFill на lucide `Volume2`
 *      в empty-state CTA («Добавить аудио»).
 *   2. Свернутый вид (`showPreview=false`) рендерить с audio-иконкой
 *      через `<KbMediaChip>` вместо BN'ного хардкоднутого RiFile2Line.
 *   3. Добавить «⋯»-кнопку в углу плеера (Notion-style) — аналог
 *      того что было сделано для видео. Без неё клик по нативным
 *      `<audio controls>` перехватывался плеером и formatting-toolbar
 *      не открывался — юзер не мог переименовать / заменить / скачать
 *      аудио.
 *
 * Подменяется в `BlockNoteSchema.create({ blockSpecs: { ...
 * defaults, audio: kbAudioBlockSpec } })` (см.
 * src/components/knowledge/blocknote-editor.tsx).
 */
import { audioParse, createAudioBlockConfig } from "@blocknote/core";
import {
  AudioToExternalHTML,
  FileBlockWrapper,
  createReactBlockSpec,
  type ReactCustomBlockRenderProps,
  useResolveUrl,
} from "@blocknote/react";
import { MoreHorizontal, Volume2 } from "lucide-react";

import { KbMediaChip } from "@/components/knowledge/blocks/kb-media-chip";
import { KbUploadProgressOverlay } from "@/app/(dashboard)/knowledge/_components/kb-upload-progress-overlay";
import { useUploadQueueEntry } from "@/app/(dashboard)/knowledge/_components/kb-upload-queue-store";
import { useCachedAudioBlobUrl } from "@/lib/knowledge/use-audio-blob-cache";

const KB_FILE_SCHEME = "kbfile://";

/** Wrapping-компонент: BN-default `<AudioPreview>` + наша «⋯»-кнопка
 *  в углу. Кнопка click → setNodeSelection через raw PM (BN-овский
 *  setSelection делает text-range, что для leaf-блоков некорректно).
 *  После selection BN-FormattingToolbar открывается и юзер видит
 *  rename / replace / delete / download кнопки. */
function KbAudioPreviewWithMenu(
  props: Omit<
    ReactCustomBlockRenderProps<typeof createAudioBlockConfig>,
    "contentRef"
  >,
) {
  const onSelect = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const editor = props.editor as unknown as {
        _tiptapEditor?: {
          view: {
            state: {
              doc: {
                descendants: (
                  cb: (
                    n: { type: { name: string }; attrs: { id?: string } },
                    pos: number,
                  ) => boolean | void,
                ) => void;
              };
            };
          };
          commands: { setNodeSelection: (pos: number) => boolean };
        };
      };
      const tiptap = editor._tiptapEditor;
      if (!tiptap) return;
      let blockPos: number | null = null;
      tiptap.view.state.doc.descendants((n, pos) => {
        if (
          n.type.name === "blockContainer" &&
          n.attrs.id === props.block.id
        ) {
          blockPos = pos;
          return false;
        }
        return undefined;
      });
      if (blockPos === null) return;
      tiptap.commands.setNodeSelection(blockPos);
    } catch {
      // Silently ignore — audio controls работают независимо.
    }
  };

  const audioUrl = props.block.props.url ?? "";
  const resolved = useResolveUrl(audioUrl);
  const storagePath = audioUrl.startsWith(KB_FILE_SCHEME)
    ? audioUrl.slice(KB_FILE_SCHEME.length)
    : null;
  const sourceUrl =
    resolved.loadingState === "loading" ? null : (resolved.downloadUrl ?? null);
  const cached = useCachedAudioBlobUrl({
    storagePath,
    sourceUrl,
  });
  const src =
    storagePath && cached.url
      ? cached.url
      : resolved.loadingState === "loading"
        ? audioUrl
        : (resolved.downloadUrl ?? audioUrl);

  return (
    <div className="kb-audio-native" contentEditable={false}>
      <audio
        key={src}
        className="bn-visual-media"
        src={src}
        controls
        preload="metadata"
        contentEditable={false}
        draggable={false}
      />
      <button
        type="button"
        // Отдельный CSS-class от kb-video-menu-btn: для аудио кнопка
        // НЕ оверлеем поверх плеера (юзер: «кнопка нашего меню
        // заслоняет настройки самого проигрывателя — speed control'ы
        // и т.п.»), а сидит inline-flex-сиблингом справа от audio-
        // элемента. Native-controls остаются полностью в распоряжении
        // плеера, наш «⋯» не перекрывает ни один контрол.
        className="kb-audio-menu-btn"
        aria-label="Открыть меню аудио"
        title="Открыть меню аудио"
        onClick={onSelect}
        onMouseDown={(e) => e.preventDefault()}
      >
        <MoreHorizontal className="size-4" strokeWidth={2.25} />
      </button>
    </div>
  );
}

function KbAudioBlock(
  props: ReactCustomBlockRenderProps<typeof createAudioBlockConfig>,
) {
  // BN-shadcn'овский FileBlockWrapper типизирован для широкого set'а
  // блок-конфигов; передаём через any как делает default ReactAudioBlock
  // в node_modules/.../blocks/Audio/block.tsx — там тот же приём.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapperProps = props as any;
  const url = props.block.props.url ?? "";
  const showPreview = props.block.props.showPreview;
  const upload = useUploadQueueEntry(props.block.id);

  // Активный upload (add ИЛИ replace flow) — overlay поверх блока.
  if (upload) {
    return <KbUploadProgressOverlay blockId={props.block.id} />;
  }

  // Legacy: showPreview=false → chip с audio-иконкой. Юзер просил
  // убрать preview-toggle button, но legacy-блоки с этим prop'ом
  // продолжают рендериться корректно.
  if (url !== "" && showPreview === false) {
    return (
      <KbMediaChip
        icon={<Volume2 size={18} strokeWidth={1.75} />}
        label={props.block.props.name || url}
        caption={props.block.props.caption}
        variant="minimal"
      />
    );
  }

  return (
    <FileBlockWrapper
      {...wrapperProps}
      buttonIcon={<Volume2 size={24} strokeWidth={1.5} />}
    >
      <KbAudioPreviewWithMenu {...wrapperProps} />
    </FileBlockWrapper>
  );
}

export const kbAudioBlockSpec = createReactBlockSpec(
  createAudioBlockConfig,
  (config) => ({
    meta: { fileBlockAccept: ["audio/*"] },
    render: KbAudioBlock,
    parse: audioParse(config),
    toExternalHTML: AudioToExternalHTML,
    runsBefore: ["file"],
  }),
);

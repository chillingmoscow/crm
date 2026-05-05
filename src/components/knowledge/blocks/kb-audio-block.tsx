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
  AudioPreview,
  AudioToExternalHTML,
  FileBlockWrapper,
  createReactBlockSpec,
  type ReactCustomBlockRenderProps,
} from "@blocknote/react";
import { MoreHorizontal, Volume2 } from "lucide-react";

import { KbMediaChip } from "@/components/knowledge/blocks/kb-media-chip";

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const previewProps = props as any;
  return (
    <div className="kb-audio-native" contentEditable={false}>
      <AudioPreview {...previewProps} />
      <button
        type="button"
        className="kb-video-menu-btn"
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

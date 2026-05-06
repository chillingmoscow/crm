/**
 * Custom KB video block — заменяет BN-default'ный `video`. Главное
 * отличие: при URL'е YouTube / Vimeo / Loom рендерит `<iframe>`-embed,
 * иначе обычный `<video src>` (как в BN).
 *
 * BN-default рендерил `<video src=youtube-url>`, что естественно не
 * проигрывалось — YouTube/Vimeo требуют iframe-embed. См.
 * sheerly.pen frame 13b · rNEwo (Вставить URL по платформе).
 *
 * Подменяется в `BlockNoteSchema.create({ blockSpecs: { ...
 * defaults, video: kbVideoBlockSpec } })` (см.
 * src/components/knowledge/blocknote-editor.tsx).
 */
import { createVideoBlockConfig, videoParse } from "@blocknote/core";
import { MoreHorizontal, Video as VideoIcon } from "lucide-react";
import {
  createReactBlockSpec,
  type ReactCustomBlockRenderProps,
  ResizableFileBlockWrapper,
  useResolveUrl,
} from "@blocknote/react";

import { KbMediaChip } from "@/components/knowledge/blocks/kb-media-chip";
import { KbUploadProgressOverlay } from "@/app/(dashboard)/knowledge/_components/kb-upload-progress-overlay";
import { useUploadQueueEntry } from "@/app/(dashboard)/knowledge/_components/kb-upload-queue-store";

// ─── URL detection ────────────────────────────────────────────────

interface EmbedTarget {
  /** URL для `<iframe src>`. */
  embedUrl: string;
  /** Provider name — для accessibility / tracking. */
  provider: "youtube" | "vimeo" | "loom" | "vidyard";
}

/** Конвертирует URL популярных видео-сервисов в их iframe-embed-формат.
 *  Возвращает null если URL не распознан как embed (тогда блок
 *  рендерит обычный `<video src>`). */
export function detectVideoEmbed(url: string): EmbedTarget | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "");

  // YouTube
  if (host === "youtube.com" || host === "m.youtube.com") {
    const v = parsed.searchParams.get("v");
    if (v) {
      return {
        embedUrl: `https://www.youtube.com/embed/${v}`,
        provider: "youtube",
      };
    }
    // /embed/ID, /shorts/ID, /v/ID — нормализуем в /embed/
    const m = parsed.pathname.match(/^\/(?:embed|shorts|v)\/([\w-]+)/);
    if (m) {
      return {
        embedUrl: `https://www.youtube.com/embed/${m[1]}`,
        provider: "youtube",
      };
    }
  }
  if (host === "youtu.be") {
    const id = parsed.pathname.replace(/^\//, "").split("/")[0];
    if (id) {
      return {
        embedUrl: `https://www.youtube.com/embed/${id}`,
        provider: "youtube",
      };
    }
  }

  // Vimeo
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = parsed.pathname.match(/(\d+)/);
    if (m) {
      return {
        embedUrl: `https://player.vimeo.com/video/${m[1]}`,
        provider: "vimeo",
      };
    }
  }

  // Loom — share URLs формата /share/<id>. Embed = /embed/<id>.
  if (host === "loom.com") {
    const m = parsed.pathname.match(/\/(?:share|embed)\/([\w-]+)/);
    if (m) {
      return {
        embedUrl: `https://www.loom.com/embed/${m[1]}`,
        provider: "loom",
      };
    }
  }

  // Vidyard
  if (host === "share.vidyard.com" || host === "play.vidyard.com") {
    const m = parsed.pathname.match(/\/watch\/([\w-]+)/);
    if (m) {
      return {
        embedUrl: `https://play.vidyard.com/${m[1]}.html`,
        provider: "vidyard",
      };
    }
  }

  return null;
}

// ─── React render ─────────────────────────────────────────────────

function VideoPreview(
  props: Omit<
    ReactCustomBlockRenderProps<typeof createVideoBlockConfig>,
    "contentRef"
  >,
) {
  const url = props.block.props.url ?? "";
  const embed = detectVideoEmbed(url);
  // Resolved URL применяется только к загруженным файлам (kbfile://
  // схеме на нашей стороне). Embed-URL'ы трогать не надо.
  const resolved = useResolveUrl(url);

  // Кнопка меню в углу видео (Notion-style). Видна на hover, click →
  // node-selection блока через ProseMirror tr → BN-FormattingToolbar
  // показывается. НЕ overlay'ем поверх всего видео (это блокировало
  // нативные `<video controls>` и iframe — юзер не мог играть/
  // ресайзить). Кнопка сама занимает 24×24 в углу, остальная
  // площадь видео доступна для plyer-controls.
  const onSelect = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      // Node-selection через raw PM (BN-овский setSelection делает
      // text-range, что для leaf-блоков — `<video>` / `<iframe>` —
      // некорректно). Находим pos блока по его id в doc.descendants.
      const editor = props.editor as unknown as {
        _tiptapEditor?: {
          view: {
            state: { doc: { descendants: (cb: (n: { type: { name: string }; attrs: { id?: string } }, pos: number) => boolean | void) => void; resolve: (p: number) => unknown; }; tr: { setSelection: (s: unknown) => unknown; }; };
            dispatch: (tr: unknown) => void;
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
      // Если что-то пошло не так — silently ignore. Resize-handles
      // и контролы всё равно работают независимо.
    }
  };

  const menuButton = (
    <button
      type="button"
      className="kb-video-menu-btn"
      aria-label="Открыть меню видео"
      title="Открыть меню видео"
      onClick={onSelect}
      onMouseDown={(e) => e.preventDefault()}
    >
      <MoreHorizontal className="size-4" strokeWidth={2.25} />
    </button>
  );

  if (embed) {
    return (
      <div
        className="bn-visual-media kb-video-embed"
        contentEditable={false}
      >
        <iframe
          src={embed.embedUrl}
          title={`${embed.provider} video`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          frameBorder={0}
        />
        {menuButton}
      </div>
    );
  }

  return (
    <div className="kb-video-native" contentEditable={false}>
      <video
        className="bn-visual-media"
        src={
          resolved.loadingState === "loading"
            ? props.block.props.url
            : resolved.downloadUrl
        }
        controls
        contentEditable={false}
        draggable={false}
      />
      {menuButton}
    </div>
  );
}

function KbVideoBlock(
  props: ReactCustomBlockRenderProps<typeof createVideoBlockConfig>,
) {
  // BN-shadcn'овский ResizableFileBlockWrapper типизирован иначе чем
  // наша renderProps (BN-internal: оборачивает любую BlockConf-форму).
  // Передаём «as unknown as never», как делает default ReactVideoBlock
  // в node_modules/.../blocks/Video/block.tsx — там тот же приём.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapperProps = props as any;
  const url = props.block.props.url ?? "";
  const showPreview = props.block.props.showPreview;
  const upload = useUploadQueueEntry(props.block.id);

  // Активный upload (add ИЛИ replace flow) — overlay поверх блока.
  if (upload) {
    return <KbUploadProgressOverlay blockId={props.block.id} />;
  }

  // showPreview=false → BN-default рендерил `FileNameWithIcon` с
  // хардкоднутой file-иконкой (RiFile2Line), что юзера сбивало с
  // толку — у видео должна быть видео-иконка. Рендерим свой
  // KbMediaChip с правильной иконкой. URL непустой — empty-state
  // wrapper всё равно сам обработает.
  if (url !== "" && showPreview === false) {
    return (
      <KbMediaChip
        icon={<VideoIcon size={18} strokeWidth={1.75} />}
        label={props.block.props.name || url}
        caption={props.block.props.caption}
        variant="minimal"
      />
    );
  }

  return (
    <ResizableFileBlockWrapper
      {...wrapperProps}
      buttonIcon={<VideoIcon size={24} strokeWidth={1.5} />}
    >
      <VideoPreview {...wrapperProps} />
    </ResizableFileBlockWrapper>
  );
}

function VideoToExternalHTML(
  props: Omit<
    ReactCustomBlockRenderProps<typeof createVideoBlockConfig>,
    "contentRef"
  >,
) {
  const url = props.block.props.url;
  if (!url) return <p>Add video</p>;
  const embed = detectVideoEmbed(url);
  if (embed) {
    return (
      <iframe src={embed.embedUrl} title="video" frameBorder={0} allowFullScreen />
    );
  }
  if (props.block.props.showPreview) {
    return <video src={url} />;
  }
  return <a href={url}>{props.block.props.name || url}</a>;
}

export const kbVideoBlockSpec = createReactBlockSpec(
  createVideoBlockConfig,
  (config) => ({
    meta: {
      fileBlockAccept: ["video/*"],
    },
    render: KbVideoBlock,
    parse: videoParse(config),
    toExternalHTML: VideoToExternalHTML,
    runsBefore: ["file"],
  }),
);

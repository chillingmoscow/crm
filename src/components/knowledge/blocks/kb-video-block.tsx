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
import { Video as VideoIcon } from "lucide-react";
import {
  createReactBlockSpec,
  type ReactCustomBlockRenderProps,
  ResizableFileBlockWrapper,
  useResolveUrl,
} from "@blocknote/react";

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

  if (embed) {
    // 16:9 aspect-ratio контейнер, iframe растягивается на всю
    // ширину/высоту wrapper'а. Width-resize реализован
    // ResizableFileBlockWrapper'ом сверху.
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
      </div>
    );
  }

  return (
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

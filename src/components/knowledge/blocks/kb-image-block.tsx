/**
 * Custom KB image block — заменяет BN-default'ный `image` исключительно
 * чтобы подменить ugly react-icons RiImage2Fill на чистый lucide `Image`
 * в empty-state CTA («Добавить изображение») и в file-name-icon чипе.
 * Логика рендера / preview / parse / resize — дефолтная BN'ная.
 *
 * Подменяется в `BlockNoteSchema.create({ blockSpecs: { ...
 * defaults, image: kbImageBlockSpec } })` (см.
 * src/components/knowledge/blocknote-editor.tsx).
 */
import { createImageBlockConfig, imageParse } from "@blocknote/core";
import {
  ImageToExternalHTML,
  ResizableFileBlockWrapper,
  createReactBlockSpec,
  type ReactCustomBlockRenderProps,
  useResolveUrl,
} from "@blocknote/react";
import { Image as ImageIcon } from "lucide-react";

import { KbMediaChip } from "@/components/knowledge/blocks/kb-media-chip";
import { KbUploadProgressOverlay } from "@/app/(dashboard)/knowledge/_components/kb-upload-progress-overlay";
import { useUploadQueueEntry } from "@/app/(dashboard)/knowledge/_components/kb-upload-queue-store";
import { useCachedImagePreviewUrl } from "@/lib/knowledge/use-image-preview-cache";

const KB_FILE_SCHEME = "kbfile://";

function KbImageBlock(
  props: ReactCustomBlockRenderProps<typeof createImageBlockConfig>,
) {
  // ResizableFileBlockWrapper типизирован для широкого set'а
  // блок-конфигов; передаём через any как делает default ReactImageBlock
  // в node_modules/.../blocks/Image/block.tsx — там тот же приём.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapperProps = props as any;
  const url = props.block.props.url ?? "";
  const showPreview = props.block.props.showPreview;
  const upload = useUploadQueueEntry(props.block.id);

  // Активный upload (add ИЛИ replace flow) — рендерим прогресс-бар
  // вместо preview / CTA. Юзер-фидбек: «при загрузке файлов показывать
  // что-то типа статус-бара». Для replace заменяем существующее preview
  // на overlay, чтобы было видно что upload идёт; после updateBlock
  // блок снова отрендерится с новым url.
  if (upload) {
    return <KbUploadProgressOverlay blockId={props.block.id} />;
  }

  // showPreview=false → BN-default рендерил file-иконку. Рендерим
  // свой chip с image-иконкой.
  if (url !== "" && showPreview === false) {
    return (
      <KbMediaChip
        icon={<ImageIcon size={18} strokeWidth={1.75} />}
        label={props.block.props.name || url}
        caption={props.block.props.caption}
        variant="minimal"
      />
    );
  }

  return (
    <ResizableFileBlockWrapper
      {...wrapperProps}
      buttonIcon={<ImageIcon size={24} strokeWidth={1.5} />}
    >
      <KbImagePreview {...wrapperProps} />
    </ResizableFileBlockWrapper>
  );
}

function KbImagePreview(
  props: Omit<
    ReactCustomBlockRenderProps<typeof createImageBlockConfig>,
    "contentRef"
  >,
) {
  const url = props.block.props.url ?? "";
  const resolved = useResolveUrl(url);
  const storagePath = url.startsWith(KB_FILE_SCHEME)
    ? url.slice(KB_FILE_SCHEME.length)
    : null;
  const sourceUrl =
    resolved.loadingState === "loading" ? null : (resolved.downloadUrl ?? null);
  const preview = useCachedImagePreviewUrl({
    storagePath,
    sourceUrl,
  });

  if (storagePath && preview.status === "loading" && !preview.url) {
    return (
      <div
        className="bn-visual-media bg-muted/40"
        aria-label="Загружаем превью изображения"
        contentEditable={false}
      />
    );
  }

  const src =
    storagePath && preview.url
      ? preview.url
      : resolved.loadingState === "loading"
        ? url
        : (resolved.downloadUrl ?? url);

  return (
    // Blob/signed URLs are editor-local and not compatible with next/image.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="bn-visual-media"
      src={src}
      alt={props.block.props.caption || "BlockNote image"}
      loading="lazy"
      decoding="async"
      contentEditable={false}
      draggable={false}
    />
  );
}

export const kbImageBlockSpec = createReactBlockSpec(
  createImageBlockConfig,
  (config) => ({
    meta: { fileBlockAccept: ["image/*"] },
    render: KbImageBlock,
    parse: imageParse(config),
    toExternalHTML: ImageToExternalHTML,
    runsBefore: ["file"],
  }),
);

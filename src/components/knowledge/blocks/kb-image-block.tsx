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
  ImagePreview,
  ImageToExternalHTML,
  ResizableFileBlockWrapper,
  createReactBlockSpec,
  type ReactCustomBlockRenderProps,
} from "@blocknote/react";
import { Image as ImageIcon } from "lucide-react";

import { KbMediaChip } from "@/components/knowledge/blocks/kb-media-chip";
import { KbUploadProgressOverlay } from "@/app/(dashboard)/knowledge/_components/kb-upload-progress-overlay";
import { useUploadQueueEntry } from "@/app/(dashboard)/knowledge/_components/kb-upload-queue-store";

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

  // Empty-state с активным upload'ом: рендерим прогресс-бар вместо
  // BN-default'ной CTA-pill, чтобы юзер видел, что файл грузится в
  // фоне (см. kb-upload-queue-store + UploadPanel).
  if (url === "" && upload) {
    return <KbUploadProgressOverlay blockId={props.block.id} />;
  }

  return (
    <ResizableFileBlockWrapper
      {...wrapperProps}
      buttonIcon={<ImageIcon size={24} strokeWidth={1.5} />}
    >
      <ImagePreview {...wrapperProps} />
    </ResizableFileBlockWrapper>
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

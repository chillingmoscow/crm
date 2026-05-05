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

function KbImageBlock(
  props: ReactCustomBlockRenderProps<typeof createImageBlockConfig>,
) {
  // ResizableFileBlockWrapper типизирован для широкого set'а
  // блок-конфигов; передаём через any как делает default ReactImageBlock
  // в node_modules/.../blocks/Image/block.tsx — там тот же приём.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapperProps = props as any;
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

/**
 * Custom KB file block — заменяет BN-default'ный `file` исключительно
 * чтобы подменить ugly react-icons RiFile2Line на чистый lucide
 * `File` в empty-state CTA («Добавить файл») и в file-name-icon чипе
 * (когда файл загружен и `showPreview=false`). Логика рендера / parse —
 * дефолтная BN'ная.
 *
 * Подменяется в `BlockNoteSchema.create({ blockSpecs: { ...
 * defaults, file: kbFileBlockSpec } })` (см.
 * src/components/knowledge/blocknote-editor.tsx).
 */
import { createFileBlockConfig, fileParse } from "@blocknote/core";
import {
  FileBlockWrapper,
  createReactBlockSpec,
  type ReactCustomBlockRenderProps,
} from "@blocknote/react";
import { File as FileIcon } from "lucide-react";

function KbFileBlock(
  props: ReactCustomBlockRenderProps<typeof createFileBlockConfig>,
) {
  // FileBlockWrapper типизирован для широкого set'а блок-конфигов,
  // используем any как делает default ReactFileBlock в BN-react.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapperProps = props as any;
  return (
    <FileBlockWrapper
      {...wrapperProps}
      buttonIcon={<FileIcon size={24} strokeWidth={1.5} />}
    />
  );
}

function FileToExternalHTML(
  props: Omit<
    ReactCustomBlockRenderProps<typeof createFileBlockConfig>,
    "contentRef"
  >,
) {
  if (!props.block.props.url) return <p>Add file</p>;
  return (
    <a href={props.block.props.url}>
      {props.block.props.name || props.block.props.url}
    </a>
  );
}

export const kbFileBlockSpec = createReactBlockSpec(createFileBlockConfig, () => ({
  render: KbFileBlock,
  parse: fileParse(),
  toExternalHTML: FileToExternalHTML,
}));

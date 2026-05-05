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

import { KbMediaChip } from "@/components/knowledge/blocks/kb-media-chip";

function KbFileBlock(
  props: ReactCustomBlockRenderProps<typeof createFileBlockConfig>,
) {
  // FileBlockWrapper типизирован для широкого set'а блок-конфигов,
  // используем any как делает default ReactFileBlock в BN-react.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapperProps = props as any;
  const url = props.block.props.url ?? "";

  // Загруженный файл (url непустой) — рендерим свой `KbMediaChip` в
  // card-варианте. Раньше FileBlockWrapper рендерил BN-default'ный
  // `FileNameWithIcon` с тем же RiFile2Line хардкоднутой иконкой,
  // плюс scoped-CSS не подхватывался (см. ниже про meta) — выглядело
  // максимально голо: маленькая иконка + filename inline. Теперь
  // pill в стиле DS: иконка + filename, border + bg + hover-accent.
  if (url !== "") {
    return (
      <KbMediaChip
        icon={<FileIcon size={18} strokeWidth={1.75} />}
        label={props.block.props.name || url}
        variant="card"
      />
    );
  }

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
  // BN использует `meta.fileBlockAccept !== undefined` чтобы
  // проставить `data-file-block` атрибут на DOM-обёртку блока. Без
  // этого `[data-file-block] .bn-add-file-button` CSS не матчится и
  // empty-state CTA («Добавить файл») рендерится без pill-стилей. */
  meta: { fileBlockAccept: ["*/*"] },
  render: KbFileBlock,
  parse: fileParse(),
  toExternalHTML: FileToExternalHTML,
}));

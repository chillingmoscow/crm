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
  useBlockNoteEditor,
} from "@blocknote/react";
import { File as FileIcon } from "lucide-react";

import { KbMediaChip } from "@/components/knowledge/blocks/kb-media-chip";

/** Экстракт расширения файла из имени для показа справа от label'а
 *  («.pdf», «.png», ...). Notion-style metadata-hint. Возвращает
 *  null если расширения нет / не распознать. */
function extractExtension(name: string | undefined | null): string | null {
  if (!name) return null;
  const m = /\.([a-zA-Z0-9]{1,10})$/.exec(name);
  return m ? `.${m[1].toLowerCase()}` : null;
}

function KbFileBlock(
  props: ReactCustomBlockRenderProps<typeof createFileBlockConfig>,
) {
  // FileBlockWrapper типизирован для широкого set'а блок-конфигов,
  // используем any как делает default ReactFileBlock в BN-react.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapperProps = props as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useBlockNoteEditor<any, any, any>();
  const url = props.block.props.url ?? "";
  const name = props.block.props.name ?? "";

  // Загруженный файл (url непустой) — рендерим свой `KbMediaChip` в
  // card-варианте. Раньше FileBlockWrapper рендерил BN-default'ный
  // `FileNameWithIcon` с тем же RiFile2Line хардкоднутой иконкой,
  // плюс scoped-CSS не подхватывался (см. ниже про meta) — выглядело
  // максимально голо: маленькая иконка + filename inline. Теперь
  // pill в стиле DS: иконка + filename, border + bg + hover-accent.
  //
  // Click → открыть в новой вкладке (юзер-фидбек). Resolve URL
  // через editor.resolveFileUrl — для kbfile:// scheme получаем
  // signed Supabase-URL, для external https:// no-op'ит.
  if (url !== "") {
    const handleClick = async (e: React.MouseEvent<HTMLDivElement>) => {
      // Игнорируем клик если PM-block уже выделен (юзер кликает второй
      // раз чтобы открыть, иначе первый клик селектит блок и formatting-
      // toolbar перехватывает фокус). На самом деле PM сам не блокирует
      // клик — просто сделаем preventDefault'а на mousedown level не
      // нужно: BN-flow «clicked-on-block → ProseMirror-selectednode →
      // open toolbar» работает параллельно.
      e.stopPropagation();
      try {
        const resolved = editor.resolveFileUrl
          ? await editor.resolveFileUrl(url)
          : url;
        window.open(resolved, "_blank", "noopener,noreferrer");
      } catch {
        // Failed to resolve — fallback to raw URL (если external).
        if (!url.startsWith("kbfile://")) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
      }
    };
    return (
      <KbMediaChip
        icon={<FileIcon size={18} strokeWidth={1.75} />}
        label={name || url}
        meta={extractExtension(name) ?? undefined}
        caption={props.block.props.caption}
        variant="card"
        onClick={handleClick}
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

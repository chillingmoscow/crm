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
import { KbUploadProgressOverlay } from "@/app/(dashboard)/knowledge/_components/kb-upload-progress-overlay";
import { useUploadQueueEntry } from "@/app/(dashboard)/knowledge/_components/kb-upload-queue-store";
import { splitFileName } from "@/lib/knowledge/file-name";
import { safeHref } from "@/lib/knowledge/safe-href";

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
  const upload = useUploadQueueEntry(props.block.id);

  // Активный upload (add ИЛИ replace flow) — overlay поверх блока.
  if (upload) {
    return <KbUploadProgressOverlay blockId={props.block.id} />;
  }

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
    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      // Codex P1 на PR #141: window.open ПОСЛЕ await editor.resolveFileUrl
      // теряет user-activation context, и popup-blocker'ы Chrome / Safari
      // режут tab. Решение: открываем blank-tab СИНХРОННО внутри click-
      // handler'а (user-gesture ещё активен), затем navigate'им его на
      // resolved URL когда async-resolve завершится. Безопасность: сами
      // обнуляем .opener чтобы новая вкладка не имела доступ к
      // window.opener (флаг "noopener" в window.open не передаём — иначе
      // он возвращает null в новых браузерах, и навигировать tab нельзя).
      const newTab = window.open("", "_blank");
      if (!newTab) return;
      try {
        newTab.opener = null;
      } catch {
        // Cross-origin write блокируется — fine.
      }
      void (async () => {
        let resolvedUrl: string;
        try {
          resolvedUrl = editor.resolveFileUrl
            ? await editor.resolveFileUrl(url)
            : url;
        } catch {
          if (!url.startsWith("kbfile://")) {
            resolvedUrl = url;
          } else {
            newTab.close();
            return;
          }
        }
        try {
          newTab.location.href = resolvedUrl;
        } catch {
          // Tab уже закрыт / cross-origin — silently.
        }
      })();
    };
    // Юзер-фидбек: «расширение есть и в названии, и дублируется
    // справа. Скрывать в названии, показывать только справа.»
    // splitFileName: label = basename, meta = extension.
    const { basename, extension } = splitFileName(name);
    return (
      <KbMediaChip
        icon={<FileIcon size={18} strokeWidth={1.75} />}
        label={basename || name || url}
        meta={extension || undefined}
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
  const rawUrl = props.block.props.url;
  if (!rawUrl) return <p>Add file</p>;
  // safeHref blocks `javascript:`/`data:` schemes that would otherwise
  // execute in exported HTML. Falls back to plain text label when the
  // stored URL is unsafe.
  const href = safeHref(rawUrl);
  const label = props.block.props.name || rawUrl;
  if (!href) return <span>{label}</span>;
  return <a href={href}>{label}</a>;
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

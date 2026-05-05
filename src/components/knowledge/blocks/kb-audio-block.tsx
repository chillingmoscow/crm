/**
 * Custom KB audio block — заменяет BN-default'ный `audio` исключительно
 * чтобы подменить ugly react-icons RiVolumeUpFill на чистый lucide
 * `Volume2` в empty-state CTA («Добавить аудио») и в file-name-icon
 * чипе. Логика рендера / preview / parse — дефолтная BN'ная.
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
import { Volume2 } from "lucide-react";

import { KbMediaChip } from "@/components/knowledge/blocks/kb-media-chip";

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

  // showPreview=false → BN-default рендерил file-иконку. Рендерим
  // свой chip с audio-иконкой.
  if (url !== "" && showPreview === false) {
    return (
      <KbMediaChip
        icon={<Volume2 size={18} strokeWidth={1.75} />}
        label={props.block.props.name || url}
        variant="minimal"
      />
    );
  }

  return (
    <FileBlockWrapper
      {...wrapperProps}
      buttonIcon={<Volume2 size={24} strokeWidth={1.5} />}
    >
      <AudioPreview {...wrapperProps} />
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

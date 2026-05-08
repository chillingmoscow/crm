"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { filenameFromURL } from "@blocknote/core";
import {
  createReactBlockSpec,
  type ReactCustomBlockRenderProps,
  useResolveUrl,
} from "@blocknote/react";
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  GripVertical,
  Image as ImageIcon,
  Images,
  Link as LinkIcon,
  Loader2,
  Plus,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { nanoid } from "nanoid";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  coerceGalleryColumns,
  coerceGalleryLayout,
  extractImageUrlsFromText,
  isLikelyImageUrl,
  KB_GALLERY_EMPTY_JSON,
  parseGalleryItemsJson,
  serializeGalleryItems,
  type KbGalleryColumns,
  type KbGalleryItem,
  type KbGalleryLayout,
} from "@/lib/knowledge/gallery";
import { validateKnowledgeFile } from "@/lib/knowledge/media-file-validation";
import { useCachedImagePreviewUrl } from "@/lib/knowledge/use-image-preview-cache";

const KB_FILE_SCHEME = "kbfile://";
const GALLERY_COLUMNS: KbGalleryColumns[] = [2, 3, 4, 5];

const galleryBlockConfig = {
  type: "gallery",
  propSchema: {
    columns: {
      default: 3,
      values: [2, 3, 4, 5] as const,
    },
    itemsJson: {
      default: KB_GALLERY_EMPTY_JSON,
      type: "string" as const,
    },
    layout: {
      default: "spotlight" as const,
      values: ["spotlight", "grid"] as const,
    },
  },
  content: "inline" as const,
};

type GalleryRenderProps = ReactCustomBlockRenderProps<
  typeof galleryBlockConfig
>;

function KbGalleryBlock({ block, editor, contentRef }: GalleryRenderProps) {
  const editable = editor.isEditable;
  const [dragOver, setDragOver] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [activeLightboxId, setActiveLightboxId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [spotlightId, setSpotlightId] = useState<string | null>(null);

  const images = useMemo(
    () => parseGalleryItemsJson(block.props.itemsJson).images,
    [block.props.itemsJson],
  );
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  useEffect(() => {
    if (images.length === 0) {
      setSpotlightId(null);
      return;
    }
    if (!spotlightId || !images.some((item) => item.id === spotlightId)) {
      setSpotlightId(images[0].id);
    }
  }, [images, spotlightId]);

  const columns = coerceGalleryColumns(block.props.columns);
  const layout = coerceGalleryLayout(block.props.layout);
  const spotlightItem =
    images.find((item) => item.id === spotlightId) ?? images[0] ?? null;
  const activeIndex = activeLightboxId
    ? images.findIndex((item) => item.id === activeLightboxId)
    : -1;
  const activeItem = activeIndex >= 0 ? images[activeIndex] : null;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const updateImages = useCallback(
    (nextImages: KbGalleryItem[]) => {
      editor.updateBlock(block.id, {
        props: { itemsJson: serializeGalleryItems(nextImages) },
      } as never);
    },
    [block.id, editor],
  );

  const updateColumns = useCallback(
    (nextColumns: KbGalleryColumns) => {
      editor.updateBlock(block.id, {
        props: { columns: nextColumns },
      } as never);
    },
    [block.id, editor],
  );

  const updateLayout = useCallback(
    (nextLayout: KbGalleryLayout) => {
      editor.updateBlock(block.id, {
        props: { layout: nextLayout },
      } as never);
    },
    [block.id, editor],
  );

  const addUrls = useCallback(
    (urls: string[]) => {
      const nextItems = urls.map((url) => ({
        id: nanoid(10),
        url,
        source: "url" as const,
        name: filenameFromURL(url) || "image",
      }));
      if (nextItems.length === 0) return;
      updateImages([...imagesRef.current, ...nextItems]);
      toast.success(
        nextItems.length === 1
          ? "Изображение добавлено"
          : `Добавлено изображений: ${nextItems.length}`,
      );
    },
    [updateImages],
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!editable || !editor.uploadFile) return;
      const accepted: File[] = [];
      for (const file of files) {
        const error = validateKnowledgeFile(file, "image");
        if (error) {
          toast.error(error);
        } else {
          accepted.push(file);
        }
      }
      if (accepted.length === 0) return;

      setUploadingCount(accepted.length);
      const uploaded: KbGalleryItem[] = [];
      try {
        await runWithConcurrency(accepted, 2, async (file) => {
          const uploadResult = await editor.uploadFile!(file);
          const url = uploadResultToUrl(uploadResult);
          uploaded.push({
            id: nanoid(10),
            url,
            source: "upload",
            name: file.name,
          });
          setUploadingCount((count) => Math.max(0, count - 1));
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Не удалось загрузить файл";
        toast.error(`Ошибка загрузки: ${message}`);
      } finally {
        setUploadingCount(0);
      }

      if (uploaded.length > 0) {
        updateImages([...imagesRef.current, ...uploaded]);
        toast.success(
          uploaded.length === 1
            ? "Изображение загружено"
            : `Загружено изображений: ${uploaded.length}`,
        );
      }
    },
    [editable, editor, updateImages],
  );

  const handleFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter((file) => {
        return file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(file.name);
      });
      if (files.length === 0) return;
      void uploadFiles(files);
    },
    [uploadFiles],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!editable) return;
      event.preventDefault();
      setDragOver(false);
      if (event.dataTransfer.files.length > 0) {
        handleFiles(event.dataTransfer.files);
        return;
      }
      const text =
        event.dataTransfer.getData("text/uri-list") ||
        event.dataTransfer.getData("text/plain");
      const urls = extractImageUrlsFromText(text);
      if (urls.length > 0) addUrls(urls);
    },
    [addUrls, editable, handleFiles],
  );

  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (!editable) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest?.(
          "input, textarea, [data-kb-gallery-description]",
        )
      ) {
        return;
      }

      if (event.clipboardData.files.length > 0) {
        event.preventDefault();
        handleFiles(event.clipboardData.files);
        return;
      }

      const text =
        event.clipboardData.getData("text/uri-list") ||
        event.clipboardData.getData("text/plain");
      const urls = extractImageUrlsFromText(text);
      if (urls.length > 0) {
        event.preventDefault();
        addUrls(urls);
      }
    },
    [addUrls, editable, handleFiles],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const current = imagesRef.current;
      const oldIndex = current.findIndex((item) => item.id === active.id);
      const newIndex = current.findIndex((item) => item.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      updateImages(arrayMove(current, oldIndex, newIndex));
    },
    [updateImages],
  );

  const updateCaption = useCallback(
    (id: string, caption: string) => {
      updateImages(
        imagesRef.current.map((item) =>
          item.id === id
            ? { ...item, caption: caption.trim() || undefined }
            : item,
        ),
      );
    },
    [updateImages],
  );

  const removeImage = useCallback(
    (id: string) => {
      updateImages(imagesRef.current.filter((item) => item.id !== id));
      if (activeLightboxId === id) setActiveLightboxId(null);
    },
    [activeLightboxId, updateImages],
  );

  const showPrevious = useCallback(() => {
    if (images.length === 0 || activeIndex < 0) return;
    const previous = images[(activeIndex - 1 + images.length) % images.length];
    setActiveLightboxId(previous.id);
  }, [activeIndex, images]);

  const showNext = useCallback(() => {
    if (images.length === 0 || activeIndex < 0) return;
    const next = images[(activeIndex + 1) % images.length];
    setActiveLightboxId(next.id);
  }, [activeIndex, images]);

  return (
    <div
      className={cn(
        "kb-gallery-block",
        dragOver && "is-dragover",
        images.length === 0 && "is-empty",
      )}
      data-editable={editable || undefined}
      onDragOver={(event) => {
        if (!editable) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onPaste={onPaste}
      tabIndex={editable ? 0 : undefined}
    >
      {editable && (
        <div className="kb-gallery-header" contentEditable={false}>
          <div className="kb-gallery-title">
            <Images className="size-4" strokeWidth={1.75} />
            <span>Галерея</span>
          </div>
          <div className="kb-gallery-toolbar">
            <div className="kb-gallery-layouts" aria-label="Вид галереи">
              {(["spotlight", "grid"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className="kb-gallery-layout-btn"
                  data-active={layout === value || undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    updateLayout(value);
                  }}
                >
                  {value === "spotlight" ? (
                    <>
                      <Images className="size-4" strokeWidth={1.75} />
                      Лента
                    </>
                  ) : (
                    <>
                      <Columns3 className="size-4" strokeWidth={1.75} />
                      Сетка
                    </>
                  )}
                </button>
              ))}
            </div>
            {layout === "grid" && (
              <div className="kb-gallery-columns" aria-label="Колонки">
                <Columns3 className="size-4" strokeWidth={1.75} />
                {GALLERY_COLUMNS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="kb-gallery-column-btn"
                    data-active={columns === value || undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      updateColumns(value);
                    }}
                  >
                    {value}
                  </button>
                ))}
              </div>
            )}
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="kb-gallery-icon-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  <Plus className="size-4" />
                  Добавить
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={8}
                className="w-auto border-0 bg-transparent p-0 shadow-none"
                onOpenAutoFocus={(event) => event.preventDefault()}
              >
                <GalleryImagePicker
                  canUpload={!!editor.uploadFile}
                  onFiles={(files) => {
                    handleFiles(files);
                    setPickerOpen(false);
                  }}
                  onUrls={(urls) => {
                    addUrls(urls);
                    setPickerOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}

      {images.length === 0 ? (
        <div
          className="kb-gallery-empty"
          contentEditable={false}
          role={editable ? "button" : undefined}
          tabIndex={editable ? 0 : undefined}
          onClick={() => editable && setPickerOpen(true)}
          onKeyDown={(event) => {
            if (!editable) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setPickerOpen(true);
            }
          }}
        >
          <UploadCloud className="size-8" strokeWidth={1.5} />
          <div className="kb-gallery-empty-title">
            Перетащите изображения сюда
          </div>
          <div className="kb-gallery-empty-sub">
            PNG, JPG, GIF, WEBP · до 10 МБ
          </div>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={images.map((item) => item.id)}
            strategy={rectSortingStrategy}
          >
            {layout === "spotlight" && spotlightItem ? (
              <GallerySpotlight
                images={images}
                selectedItem={spotlightItem}
                editable={editable}
                onSelect={(id) => setSpotlightId(id)}
                onOpen={() => setActiveLightboxId(spotlightItem.id)}
                onCaptionChange={(caption) =>
                  updateCaption(spotlightItem.id, caption)
                }
                onRemove={removeImage}
              />
            ) : (
              <div
                className="kb-gallery-grid"
                style={{
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
                contentEditable={false}
              >
                {images.map((item) => (
                  <SortableGalleryItem
                    key={item.id}
                    item={item}
                    editable={editable}
                    onOpen={() => setActiveLightboxId(item.id)}
                    onCaptionChange={(caption) =>
                      updateCaption(item.id, caption)
                    }
                    onRemove={() => removeImage(item.id)}
                  />
                ))}
              </div>
            )}
          </SortableContext>
        </DndContext>
      )}

      {editable && uploadingCount > 0 && (
        <div className="kb-gallery-uploading" role="status" contentEditable={false}>
          <Loader2 className="size-4 animate-spin" />
          Загружаем: {uploadingCount}
        </div>
      )}

      <div className="kb-gallery-description-wrap">
        <div
          ref={contentRef}
          className="kb-gallery-description"
          data-kb-gallery-description
          data-placeholder="Описание галереи"
        />
      </div>

      <Dialog
        open={!!activeItem}
        onOpenChange={(open) => {
          if (!open) setActiveLightboxId(null);
        }}
      >
        <DialogContent
          className="kb-gallery-lightbox"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              showPrevious();
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              showNext();
            }
          }}
        >
          <DialogTitle className="sr-only">
            Просмотр изображения галереи
          </DialogTitle>
          {activeItem && (
            <>
              <div className="kb-gallery-lightbox-media">
                <GalleryResolvedImage item={activeItem} variant="lightbox" />
              </div>
              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    className="kb-gallery-lightbox-nav is-left"
                    onClick={showPrevious}
                    aria-label="Предыдущее изображение"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                  <button
                    type="button"
                    className="kb-gallery-lightbox-nav is-right"
                    onClick={showNext}
                    aria-label="Следующее изображение"
                  >
                    <ChevronRight className="size-5" />
                  </button>
                </>
              )}
              {(activeItem.caption || activeItem.name) && (
                <div className="kb-gallery-lightbox-caption">
                  {activeItem.caption || activeItem.name}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SortableGalleryItem({
  item,
  editable,
  onOpen,
  onCaptionChange,
  onRemove,
}: {
  item: KbGalleryItem;
  editable: boolean;
  onOpen: () => void;
  onCaptionChange: (caption: string) => void;
  onRemove: () => void;
}) {
  const sortable = useSortable({ id: item.id, disabled: !editable });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <article
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        "kb-gallery-item",
        sortable.isDragging && "is-dragging",
      )}
    >
      <button
        type="button"
        className="kb-gallery-image-btn"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpen();
        }}
      >
        <GalleryResolvedImage item={item} variant="thumb" />
      </button>
      {editable && (
        <div className="kb-gallery-item-actions">
          <button
            type="button"
            className="kb-gallery-item-action"
            aria-label="Переместить изображение"
            {...sortable.attributes}
            {...sortable.listeners}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <GripVertical className="size-4" />
          </button>
          <button
            type="button"
            className="kb-gallery-item-action"
            aria-label="Удалить изображение"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemove();
            }}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      )}
      {editable ? (
        <GalleryCaptionInput
          value={item.caption ?? ""}
          onCommit={onCaptionChange}
        />
      ) : item.caption ? (
        <div className="kb-gallery-caption">{item.caption}</div>
      ) : null}
    </article>
  );
}

function GallerySpotlight({
  images,
  selectedItem,
  editable,
  onSelect,
  onOpen,
  onCaptionChange,
  onRemove,
}: {
  images: KbGalleryItem[];
  selectedItem: KbGalleryItem;
  editable: boolean;
  onSelect: (id: string) => void;
  onOpen: () => void;
  onCaptionChange: (caption: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="kb-gallery-spotlight" contentEditable={false}>
      <button
        type="button"
        className="kb-gallery-spotlight-main"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpen();
        }}
      >
        <GalleryResolvedImage item={selectedItem} variant="spotlight" />
      </button>
      {editable ? (
        <GalleryCaptionInput
          value={selectedItem.caption ?? ""}
          onCommit={onCaptionChange}
        />
      ) : selectedItem.caption ? (
        <div className="kb-gallery-caption kb-gallery-spotlight-caption">
          {selectedItem.caption}
        </div>
      ) : null}
      {images.length > 1 && (
        <div className="kb-gallery-spotlight-strip" aria-label="Изображения">
          {images.map((item) => (
            <SortableGalleryThumb
              key={item.id}
              item={item}
              active={item.id === selectedItem.id}
              editable={editable}
              onSelect={() => onSelect(item.id)}
              onRemove={() => onRemove(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SortableGalleryThumb({
  item,
  active,
  editable,
  onSelect,
  onRemove,
}: {
  item: KbGalleryItem;
  active: boolean;
  editable: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const sortable = useSortable({ id: item.id, disabled: !editable });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        "kb-gallery-thumb",
        active && "is-active",
        sortable.isDragging && "is-dragging",
      )}
    >
      <button
        type="button"
        className="kb-gallery-thumb-btn"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelect();
        }}
      >
        <GalleryResolvedImage item={item} variant="thumb" />
      </button>
      {editable && (
        <div className="kb-gallery-thumb-actions">
          <button
            type="button"
            className="kb-gallery-item-action"
            aria-label="Переместить изображение"
            {...sortable.attributes}
            {...sortable.listeners}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <GripVertical className="size-4" />
          </button>
          <button
            type="button"
            className="kb-gallery-item-action"
            aria-label="Удалить изображение"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemove();
            }}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function GalleryCaptionInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);
  useEffect(() => {
    resizeTextarea(ref.current);
  }, [draft]);

  const commit = () => {
    if (draft.trim() !== value.trim()) {
      onCommit(draft);
    }
  };

  return (
    <textarea
      ref={ref}
      value={draft}
      rows={1}
      onChange={(event) => {
        setDraft(event.target.value);
        resizeTextarea(event.currentTarget);
      }}
      onBlur={commit}
      onClick={(event) => event.stopPropagation()}
      onPaste={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      className="kb-gallery-caption-input"
      placeholder="Подпись"
    />
  );
}

function GalleryImagePicker({
  canUpload,
  onFiles,
  onUrls,
}: {
  canUpload: boolean;
  onFiles: (files: File[]) => void;
  onUrls: (urls: string[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"upload" | "url">(
    canUpload ? "upload" : "url",
  );
  const [urlValue, setUrlValue] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const submitUrl = () => {
    const urls = extractImageUrlsFromText(urlValue);
    if (urls.length === 0 && isLikelyImageUrl(urlValue)) {
      urls.push(urlValue.trim());
    }
    if (urls.length === 0) {
      toast.error("Вставьте прямую ссылку на JPG, PNG, GIF или WEBP");
      return;
    }
    onUrls(urls);
    setUrlValue("");
  };

  const pickFiles = (fileList: FileList | null) => {
    const files = fileList ? Array.from(fileList) : [];
    if (files.length > 0) onFiles(files);
  };

  return (
    <div className="kb-file-panel kb-gallery-picker">
      <div className="kb-file-panel-tabs" role="tablist">
        {canUpload && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "upload"}
            data-active={tab === "upload" || undefined}
            onClick={() => setTab("upload")}
            className="kb-file-panel-tab"
          >
            Файл
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={tab === "url"}
          data-active={tab === "url" || undefined}
          onClick={() => setTab("url")}
          className="kb-file-panel-tab"
        >
          Ссылка
        </button>
      </div>

      {tab === "upload" && canUpload ? (
        <div className="kb-file-panel-body">
          <div
            className={cn("kb-file-panel-dropzone", dragOver && "is-dragover")}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              pickFiles(event.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                inputRef.current?.click();
              }
            }}
          >
            <UploadCloud className="size-7 text-muted-foreground" />
            <div className="kb-file-panel-dropzone-title">
              Перетащите изображения сюда
            </div>
            <div className="kb-file-panel-dropzone-sub">
              или нажмите, чтобы выбрать файлы
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              className="sr-only"
              aria-hidden
              tabIndex={-1}
              onChange={(event) => {
                pickFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
          <div className="kb-file-panel-hint">
            PNG, JPG, GIF, WEBP · до 10 МБ
          </div>
        </div>
      ) : (
        <div className="kb-file-panel-body">
          <div className="kb-gallery-picker-url">
            <LinkIcon className="size-4 text-muted-foreground" strokeWidth={1.75} />
            <Input
              type="url"
              value={urlValue}
              onChange={(event) => setUrlValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submitUrl();
                }
              }}
              placeholder="Вставьте ссылку на изображение"
              autoFocus
              className="h-10"
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={submitUrl}
              disabled={!urlValue.trim()}
              size="sm"
            >
              Вставить
            </Button>
          </div>
          <div className="kb-file-panel-hint kb-file-panel-hint-multiline">
            Прямая ссылка на изображение JPG, PNG, GIF или WEBP
          </div>
        </div>
      )}
    </div>
  );
}

function GalleryResolvedImage({
  item,
  variant,
}: {
  item: KbGalleryItem;
  variant: "thumb" | "spotlight" | "lightbox";
}) {
  const [failed, setFailed] = useState(false);
  const resolved = useResolveUrl(item.url);
  const storagePath = item.url.startsWith(KB_FILE_SCHEME)
    ? item.url.slice(KB_FILE_SCHEME.length)
    : null;
  const sourceUrl =
    resolved.loadingState === "loading" ? null : (resolved.downloadUrl ?? null);
  const preview = useCachedImagePreviewUrl({
    storagePath,
    sourceUrl,
  });

  const src =
    storagePath && preview.url
      ? preview.url
      : resolved.loadingState === "loading"
        ? item.url
        : (resolved.downloadUrl ?? item.url);

  if (failed) {
    return (
      <div className="kb-gallery-image-fallback">
        <ImageIcon className="size-6" strokeWidth={1.5} />
      </div>
    );
  }

  if (storagePath && preview.status === "loading" && !preview.url) {
    return <div className="kb-gallery-image-loading" aria-hidden />;
  }

  return (
    // Blob/signed URLs are editor-local and not compatible with next/image.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={cn(
        "kb-gallery-image",
        variant === "spotlight" && "kb-gallery-image-spotlight",
        variant === "lightbox" && "kb-gallery-image-lightbox",
      )}
      src={src}
      alt={item.alt || item.caption || item.name || "Gallery image"}
      loading={variant === "thumb" ? "lazy" : "eager"}
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

function GalleryToExternalHTML(props: GalleryRenderProps) {
  const images = parseGalleryItemsJson(props.block.props.itemsJson).images;
  if (images.length === 0) {
    return <p>Gallery</p>;
  }
  return (
    <div>
      {images.map((item) => (
        <figure key={item.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.url} alt={item.alt || item.caption || item.name || ""} />
          {item.caption && <figcaption>{item.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        await worker(item);
      }
    },
  );
  await Promise.all(runners);
}

function uploadResultToUrl(result: string | Record<string, unknown>): string {
  if (typeof result === "string") return result;
  const props = result.props as { url?: unknown } | undefined;
  if (typeof props?.url === "string" && props.url.trim() !== "") {
    return props.url;
  }
  throw new Error("Upload did not return an image URL");
}

function resizeTextarea(node: HTMLTextAreaElement | null) {
  if (!node) return;
  node.style.height = "auto";
  node.style.height = `${node.scrollHeight}px`;
}

export const kbGalleryBlockSpec = createReactBlockSpec(
  galleryBlockConfig,
  {
    render: KbGalleryBlock,
    toExternalHTML: GalleryToExternalHTML,
  },
);

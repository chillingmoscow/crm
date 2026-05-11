"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
} from "@dnd-kit/sortable";
import { filenameFromURL } from "@blocknote/core";
import {
  createReactBlockSpec,
  type ReactCustomBlockRenderProps,
} from "@blocknote/react";
import {
  ChevronDown,
  Check,
  Columns3,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  SlidersHorizontal,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  coerceGalleryColumns,
  extractImageUrlsFromText,
  isLikelyImageUrl,
  KB_GALLERY_EMPTY_JSON,
  parseGalleryItemsJson,
  serializeGalleryItems,
  type KbGalleryColumns,
  type KbGalleryItem,
} from "@/lib/knowledge/gallery";
import { validateKnowledgeFile } from "@/lib/knowledge/media-file-validation";
import { runWithConcurrency } from "@/lib/run-with-concurrency";

import { GalleryImagePicker } from "./gallery/image-picker";
import { GalleryMenuSwitchIndicator } from "./gallery/menu-switch-indicator";
import { GalleryResolvedImage } from "./gallery/resolved-image";
import { SortableGalleryItem } from "./gallery/sortable-item";
import {
  KB_FILE_SCHEME,
  stopBlockInteraction,
  stopBlockMenuAction,
} from "./gallery/shared";

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
      default: "grid" as const,
      values: ["spotlight", "grid"] as const,
    },
    showCaptions: {
      default: false,
    },
    imageFit: {
      default: "cover" as const,
      values: ["cover", "contain"] as const,
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState<"columns" | null>(null);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const recentDragRef = useRef(false);

  const images = useMemo(
    () => parseGalleryItemsJson(block.props.itemsJson).images,
    [block.props.itemsJson],
  );
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  useLayoutEffect(() => {
    const element = blockRef.current;
    if (!element) return;

    const updatePreviewWidth = () => {
      const nextWidth = Math.round(element.getBoundingClientRect().width);
      if (nextWidth <= 0) return;
      setPreviewWidth((current) =>
        current === nextWidth ? current : nextWidth,
      );
    };

    updatePreviewWidth();
    const resizeObserver = new ResizeObserver(updatePreviewWidth);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  const columns = coerceGalleryColumns(block.props.columns);
  const showCaptions = block.props.showCaptions === true;
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

  const updateShowCaptions = useCallback(
    (nextValue: boolean) => {
      editor.updateBlock(block.id, {
        props: { showCaptions: nextValue },
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
      window.setTimeout(() => {
        recentDragRef.current = false;
      }, 0);
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

  const replaceImage = useCallback(
    async (id: string, file: File) => {
      if (!editable || !editor.uploadFile) return;
      const validationError = validateKnowledgeFile(file, "image");
      if (validationError) {
        toast.error(validationError);
        return;
      }

      setUploadingCount(1);
      try {
        const uploadResult = await editor.uploadFile(file);
        const url = uploadResultToUrl(uploadResult);
        updateImages(
          imagesRef.current.map((item) =>
            item.id === id
              ? {
                  ...item,
                  url,
                  source: "upload",
                  name: file.name,
                }
              : item,
          ),
        );
        toast.success("Изображение заменено");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Не удалось загрузить файл";
        toast.error(`Ошибка загрузки: ${message}`);
      } finally {
        setUploadingCount(0);
      }
    },
    [editable, editor, updateImages],
  );

  const replaceImageWithUrl = useCallback(
    (id: string, url: string) => {
      const trimmedUrl = url.trim();
      if (!isLikelyImageUrl(trimmedUrl)) {
        toast.error("Вставьте прямую ссылку на JPG, PNG, GIF или WEBP");
        return;
      }
      updateImages(
        imagesRef.current.map((item) =>
          item.id === id
            ? {
                ...item,
                url: trimmedUrl,
                source: "url",
                name: filenameFromURL(trimmedUrl) || item.name || "image",
              }
            : item,
        ),
      );
      toast.success("Изображение заменено");
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

  const openOriginalImage = useCallback(
    (item: KbGalleryItem) => {
      const newTab = window.open("", "_blank");
      if (!newTab) return;
      try {
        newTab.opener = null;
      } catch {
        /* ignore */
      }
      void (async () => {
        let url = item.url;
        try {
          url = editor.resolveFileUrl ? await editor.resolveFileUrl(item.url) : item.url;
        } catch {
          if (item.url.startsWith(KB_FILE_SCHEME)) {
            newTab.close();
            toast.error("Не удалось открыть оригинал");
            return;
          }
        }
        try {
          newTab.location.href = url;
        } catch {
          /* tab closed */
        }
      })();
    },
    [editor],
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
  const blockStyle = (
    previewWidth
      ? { "--kb-gallery-preview-width": `${previewWidth}px` }
      : undefined
  ) as CSSProperties | undefined;

  return (
    <div
      ref={blockRef}
      className={cn(
        "kb-gallery-block",
        dragOver && "is-dragover",
        images.length === 0 && "is-empty",
      )}
      style={blockStyle}
      data-editable={editable || undefined}
      data-controls-open={pickerOpen || settingsOpen || undefined}
      data-kb-gallery-block
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
          <div className="kb-gallery-toolbar">
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  className="kb-gallery-add-btn"
                  onPointerDown={stopBlockInteraction}
                  onMouseDown={stopBlockInteraction}
                  onClick={stopBlockInteraction}
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
                  mode="add"
                  multiple
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
            <Popover
              open={settingsOpen}
              onOpenChange={(open) => {
                setSettingsOpen(open);
                if (!open) setSettingsPanel(null);
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="kb-gallery-settings-btn"
                  aria-label="Настройки галереи"
                  onPointerDown={stopBlockInteraction}
                  onMouseDown={stopBlockInteraction}
                  onClick={stopBlockInteraction}
                >
                  <SlidersHorizontal className="size-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={8}
                className="kb-gallery-popover-menu kb-gallery-settings-menu w-56"
                onPointerDown={stopBlockInteraction}
                onMouseDown={stopBlockInteraction}
                onClick={stopBlockInteraction}
                onOpenAutoFocus={(event) => event.preventDefault()}
              >
                <div className="kb-gallery-menu-label">Настройки</div>
                <button
                  type="button"
                  className="kb-gallery-menu-item kb-gallery-menu-item-with-control"
                  aria-expanded={settingsPanel === "columns"}
                  onPointerDown={stopBlockInteraction}
                  onMouseDown={stopBlockInteraction}
                  onClick={(event) => {
                    stopBlockMenuAction(event);
                    setSettingsPanel((panel) =>
                      panel === "columns" ? null : "columns",
                    );
                  }}
                >
                  <span className="kb-gallery-menu-icon" aria-hidden>
                    <Columns3 className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">Сетка</span>
                  <span className="kb-gallery-menu-value">{columns}</span>
                  <ChevronDown className="kb-gallery-menu-chevron size-4" />
                </button>
                {settingsPanel === "columns" && (
                  <div className="kb-gallery-popover-menu kb-gallery-grid-submenu">
                    {GALLERY_COLUMNS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="kb-gallery-menu-option"
                        data-active={columns === value || undefined}
                        onPointerDown={stopBlockInteraction}
                        onMouseDown={stopBlockInteraction}
                        onClick={(event) => {
                          stopBlockMenuAction(event);
                          updateColumns(value);
                        }}
                      >
                        <span>{value}</span>
                        {columns === value ? <Check className="size-4" /> : null}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="kb-gallery-menu-item kb-gallery-menu-item-with-control"
                  aria-pressed={showCaptions}
                  data-active={showCaptions || undefined}
                  onClick={(event) => {
                    stopBlockMenuAction(event);
                    updateShowCaptions(!showCaptions);
                  }}
                >
                  <span className="kb-gallery-menu-icon" aria-hidden>
                    <Pencil className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">Подписи</span>
                  <GalleryMenuSwitchIndicator checked={showCaptions} />
                </button>
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
          onDragStart={() => {
            recentDragRef.current = true;
          }}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            window.setTimeout(() => {
              recentDragRef.current = false;
            }, 0);
          }}
        >
          <SortableContext
            items={images.map((item) => item.id)}
            strategy={rectSortingStrategy}
          >
            <div
              className="kb-gallery-grid"
              data-columns={columns}
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
                  showCaptions={showCaptions}
                  onOpen={() => {
                    if (recentDragRef.current) return;
                    setActiveLightboxId(item.id);
                  }}
                  onUpdateCaption={(caption) => updateCaption(item.id, caption)}
                  onReplace={(file) => void replaceImage(item.id, file)}
                  onReplaceUrl={(url) => replaceImageWithUrl(item.id, url)}
                  onRemove={() => removeImage(item.id)}
                  onOpenOriginal={() => openOriginalImage(item)}
                  onPointerSettled={() => {
                    window.setTimeout(() => {
                      recentDragRef.current = false;
                    }, 0);
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {editable && uploadingCount > 0 && (
        <div className="kb-gallery-uploading" role="status" contentEditable={false}>
          <Loader2 className="size-4 animate-spin" />
          Загружаем: {uploadingCount}
        </div>
      )}

      <div className="kb-gallery-description-wrap" hidden>
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
              <div className="kb-gallery-lightbox-frame">
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
              </div>
              {images.length > 1 && activeIndex >= 0 && (
                <div
                  className="kb-gallery-lightbox-dots"
                  aria-label={`Изображение ${activeIndex + 1} из ${images.length}`}
                >
                  {images.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      className="kb-gallery-lightbox-dot"
                      data-active={index === activeIndex || undefined}
                      aria-label={`Показать изображение ${index + 1} из ${images.length}`}
                      aria-current={index === activeIndex ? "true" : undefined}
                      onClick={() => setActiveLightboxId(item.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
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


function uploadResultToUrl(result: string | Record<string, unknown>): string {
  if (typeof result === "string") return result;
  const props = result.props as { url?: unknown } | undefined;
  if (typeof props?.url === "string" && props.url.trim() !== "") {
    return props.url;
  }
  throw new Error("Upload did not return an image URL");
}

export const kbGalleryBlockSpec = createReactBlockSpec(
  galleryBlockConfig,
  {
    render: KbGalleryBlock,
    toExternalHTML: GalleryToExternalHTML,
  },
);

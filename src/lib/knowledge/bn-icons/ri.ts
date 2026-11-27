import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, CaseSensitive, Check, Code,
  Download, ExternalLink, File, Film, Heading1, Heading2, Heading3, Heading4, Heading5,
  Heading6, Image, ImagePlus, ImageUp, IndentDecrease, IndentIncrease, Italic, Link,
  List, ListChecks, ListCollapse, ListOrdered, MessageSquare, Minus, MoreHorizontal, Pencil,
  Plus, Quote, Smile, SquareCode, Strikethrough, Table, TableCellsMerge,
  TextCursorInput, Trash2, Type, Underline, Undo2, Unlink, Video, Volume2,
} from "lucide-react";

import { makeBnIcon } from "./make.ts";

// Подмена `react-icons/ri` для BlockNote (next.config.ts). Имена — ровно те,
// что импортирует @blocknote/react; полноту сторожит bn-icons.test.mts.
export const RiAddFill = makeBnIcon(Plus);
export const RiAlignCenter = makeBnIcon(AlignCenter);
export const RiAlignJustify = makeBnIcon(AlignJustify);
export const RiAlignLeft = makeBnIcon(AlignLeft);
export const RiAlignRight = makeBnIcon(AlignRight);
export const RiBold = makeBnIcon(Bold);
export const RiChat3Line = makeBnIcon(MessageSquare);
export const RiCodeBlock = makeBnIcon(SquareCode);
export const RiCodeFill = makeBnIcon(Code);
export const RiDeleteBin7Line = makeBnIcon(Trash2);
export const RiDownload2Fill = makeBnIcon(Download);
export const RiEmotionFill = makeBnIcon(Smile);
export const RiExternalLinkFill = makeBnIcon(ExternalLink);
export const RiFile2Line = makeBnIcon(File);
export const RiFilmLine = makeBnIcon(Film);
export const RiFontFamily = makeBnIcon(CaseSensitive);
export const RiH1 = makeBnIcon(Heading1);
export const RiH2 = makeBnIcon(Heading2);
export const RiH3 = makeBnIcon(Heading3);
export const RiH4 = makeBnIcon(Heading4);
export const RiH5 = makeBnIcon(Heading5);
export const RiH6 = makeBnIcon(Heading6);
export const RiImage2Fill = makeBnIcon(Image);
export const RiImageAddFill = makeBnIcon(ImagePlus);
export const RiImageEditFill = makeBnIcon(ImageUp);
export const RiIndentDecrease = makeBnIcon(IndentDecrease);
export const RiIndentIncrease = makeBnIcon(IndentIncrease);
export const RiInputField = makeBnIcon(TextCursorInput);
export const RiItalic = makeBnIcon(Italic);
export const RiLink = makeBnIcon(Link);
export const RiLinkUnlink = makeBnIcon(Unlink);
export const RiListCheck3 = makeBnIcon(ListChecks);
export const RiListOrdered = makeBnIcon(ListOrdered);
export const RiListUnordered = makeBnIcon(List);
export const RiMergeCellsHorizontal = makeBnIcon(TableCellsMerge);
// BlockNote рисует этим значком объединение ячеек по вертикали — тоже «объединить».
export const RiMergeCellsVertical = makeBnIcon(TableCellsMerge);
// В BlockNote — «Сворачиваемый список».
export const RiPlayList2Fill = makeBnIcon(ListCollapse);
export const RiQuoteText = makeBnIcon(Quote);
export const RiStrikethrough = makeBnIcon(Strikethrough);
export const RiSubtractLine = makeBnIcon(Minus);
export const RiTable2 = makeBnIcon(Table);
export const RiText = makeBnIcon(Type);
export const RiUnderline = makeBnIcon(Underline);
export const RiVideoFill = makeBnIcon(Video);
export const RiVolumeUpFill = makeBnIcon(Volume2);
// Комментарии (FloatingThreadController).
export const RiArrowGoBackFill = makeBnIcon(Undo2);
export const RiCheckFill = makeBnIcon(Check);
export const RiDeleteBinFill = makeBnIcon(Trash2);
export const RiEditFill = makeBnIcon(Pencil);
export const RiEmotionLine = makeBnIcon(Smile);
export const RiMoreFill = makeBnIcon(MoreHorizontal);

import { ChevronDown, GripVertical } from "lucide-react";

import { makeBnIcon } from "./make.ts";

// Подмена `react-icons/md` для BlockNote (next.config.ts).
export const MdArrowDropDown = makeBnIcon(ChevronDown);
export const MdDragIndicator = makeBnIcon(GripVertical);

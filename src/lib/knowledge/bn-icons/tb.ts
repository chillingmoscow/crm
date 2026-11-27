import { SeparatorHorizontal } from "lucide-react";

import { makeBnIcon } from "./make.ts";

// Подмена `react-icons/tb` для BlockNote (next.config.ts).
export const TbPageBreak = makeBnIcon(SeparatorHorizontal);

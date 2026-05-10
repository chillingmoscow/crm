import {
  ArrowDownAZ,
  ArrowUpDown,
  Copy,
  Eye,
  EyeOff,
  Gauge,
  Hash,
  Info,
  Paintbrush,
  Trash2,
  Type,
} from "lucide-react";

export const KB_PROPERTY_UI_ICONS = {
  description: Info,
  display: Paintbrush,
  duplicate: Copy,
  hidden: EyeOff,
  rating: Gauge,
  scale: Hash,
  showValue: Hash,
  sort: ArrowUpDown,
  sortDirection: ArrowDownAZ,
  type: Type,
  visibility: Eye,
  delete: Trash2,
} as const;

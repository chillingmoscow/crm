"use client";

import { Fragment, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type TableRowMenuAction = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
};

type TableRowMenuProps = {
  actions: TableRowMenuAction[];
};

export function TableRowMenu({ actions }: TableRowMenuProps) {
  return (
    <DropdownMenu>
      <Tooltip delayDuration={450}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-foreground/80 hover:text-foreground">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Действия строки</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>
          Действия строки
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        {actions.map((action) => (
          <Fragment key={action.label}>
            {action.separatorBefore ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              disabled={action.disabled}
              className={action.destructive ? "text-destructive focus:text-destructive" : "text-foreground"}
              onSelect={action.onSelect}
            >
              {action.icon ? (
                <span className="mr-2 flex h-4 w-4 items-center justify-center text-current [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-current">
                  {action.icon}
                </span>
              ) : null}
              {action.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

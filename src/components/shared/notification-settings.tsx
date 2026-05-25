"use client";

import { Settings, Share } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { usePushSubscription } from "@/hooks/use-push-subscription";

const ICON_BTN =
  "inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors";

/**
 * Кнопка-шестерёнка в шапке колокольчика → поповер настроек push.
 * Управление вынесено сюда из инлайн-строки списка. Push — per-device.
 */
export function NotificationSettings() {
  const {
    supported,
    configured,
    permission,
    subscribed,
    busy,
    standalone,
    isIOS,
    enable,
    disable,
  } = usePushSubscription();

  const denied = permission === "denied" && !subscribed;

  return (
    <Popover>
      <IconTooltip label="Настройки уведомлений">
        <PopoverTrigger
          className={ICON_BTN}
          aria-label="Настройки уведомлений"
        >
          <Settings className="size-[18px]" />
        </PopoverTrigger>
      </IconTooltip>
      <PopoverContent align="end" sideOffset={6} className="w-72 p-0">
        <div className="border-b border-border/60 px-3 py-2.5">
          <div className="text-[13px] font-semibold">Push-уведомления</div>
        </div>
        <div className="p-3">
          {!configured ? (
            <p className="text-xs text-muted-foreground">
              Push сейчас недоступны.
            </p>
          ) : isIOS && !standalone ? (
            <div className="flex items-start gap-2 text-xs leading-snug text-muted-foreground">
              <Share className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Чтобы получать push на iPhone, добавьте приложение на экран
                «Домой»:{" "}
                <span className="font-medium text-foreground">
                  Поделиться → На экран «Домой»
                </span>
                , затем откройте его и включите push здесь.
              </span>
            </div>
          ) : !supported ? (
            <p className="text-xs text-muted-foreground">
              Этот браузер не поддерживает push-уведомления.
            </p>
          ) : (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium leading-tight text-foreground">
                  На этом устройстве
                </div>
                <div className="text-[11px] leading-tight text-muted-foreground">
                  {denied
                    ? "Заблокированы в настройках браузера"
                    : "Приходят при закрытом приложении"}
                </div>
              </div>
              <Switch
                checked={subscribed}
                disabled={busy || denied}
                onCheckedChange={(v) => (v ? enable() : disable())}
                aria-label="Push на этом устройстве"
              />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

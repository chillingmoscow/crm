import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { NextRequest, NextResponse } from "next/server";
import { runOneSlice, scheduleDueDays } from "@/lib/sales/sync";
import { scheduleHistoryDay } from "@/lib/sales/history-backfill-run";
import {
  scheduleAdditionalReports,
  processAdditionalReport,
} from "@/lib/sales/additional-sync";
import { scheduleUpsellDays, processUpsellDay } from "@/lib/sales/upsell-sync";
import {
  scheduleStatisticsReports,
  processStatisticsReport,
} from "@/lib/sales/statistics-sync";
import {
  scheduleStockWriteoffs,
  processStockWriteoff,
} from "@/lib/stock/writeoff-sync";
import {
  scheduleSettlements,
  processSettlement,
} from "@/lib/sales/settlement-sync";
import {
  scheduleCashControls,
  processCashControl,
} from "@/lib/sales/cash-control-sync";
import {
  scheduleCashMovements,
  processCashMovement,
} from "@/lib/sales/cash-movement-sync";
import {
  scheduleNativeFinance,
  processNativeFinance,
} from "@/lib/finance/native-sync";
import { scheduleGuestReads, processGuestRead } from "@/lib/guests/sync";
import { scheduleSupplies, processSupplyRead } from "@/lib/supplies/sync";
import { processDueQuickRestoSync } from "@/lib/inventory/quickresto-sync";
import { processDishPhotos } from "@/lib/inventory/dish-photo-sync";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "Обработчик смен не настроен" },
      { status: 503 },
    );
  const expected = Buffer.from(secret),
    actual = Buffer.from(request.headers.get("x-cron-secret") ?? "");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return NextResponse.json({ error: "Нет доступа" }, { status: 401 });
  try {
    const queued = await scheduleDueDays();
    // История продаж для прогноза плана: по дню, только когда очередь пуста.
    try {
      await scheduleHistoryDay();
    } catch (error) {
      console.error("[sales-history] догрузка истории:", error instanceof Error ? error.message : error);
    }
    let slices = 0,
      failed = 0,
      monthReports = 0,
      monthReportErrors = 0,
      additionalReports = 0,
      additionalErrors = 0,
      stockSlices = 0,
      stockErrors = 0,
      settlementSlices = 0,
      settlementErrors = 0,
      cashControlSlices = 0,
      cashControlErrors = 0,
      cashMovementSlices = 0,
      cashMovementErrors = 0,
      nativeFinanceSlices = 0,
      nativeFinanceErrors = 0,
      guestSlices = 0,
      guestErrors = 0,
      supplySlices = 0,
      supplyErrors = 0,
      supplyPending = 0,
      nomenclatureRuns = 0,
      nomenclatureErrors = 0,
      dishPhotoRuns = 0,
      dishPhotoErrors = 0,
      dishPhotosDownloaded = 0;
    try {
      await scheduleStatisticsReports();
    } catch {
      monthReportErrors++;
    }
    try {
      await scheduleAdditionalReports();
    } catch {
      additionalErrors++;
    }
    try {
      await scheduleUpsellDays();
    } catch {
      additionalErrors++;
    }
    try {
      await scheduleStockWriteoffs();
    } catch {
      stockErrors++;
    }
    try {
      await scheduleSettlements();
    } catch {
      settlementErrors++;
    }
    try {
      await scheduleCashControls();
    } catch {
      cashControlErrors++;
    }
    try {
      await scheduleCashMovements();
    } catch {
      cashMovementErrors++;
    }
    try {
      await scheduleNativeFinance();
    } catch {
      nativeFinanceErrors++;
    }
    try {
      await scheduleGuestReads();
    } catch {
      guestErrors++;
    }
    try {
      supplyPending = await scheduleSupplies();
    } catch {
      supplyErrors++;
    }
    // The full Quick Resto sync (nomenclature, stores, open inventory acts —
    // the same as the «Синхронизировать» button) runs once per account every
    // few hours (see NOMENCLATURE_SYNC_INTERVAL_MS). A tick that ran it is its provider
    // workload: the lanes below wait for the next tick, and the rotation is
    // not advanced, so no queue loses its turn.
    let nomenclatureBusy = false;
    try {
      const r = await processDueQuickRestoSync();
      if (!r.idle) {
        nomenclatureBusy = true;
        nomenclatureRuns++;
        if (r.error) nomenclatureErrors++;
      }
    } catch (error) {
      nomenclatureErrors++;
      console.error(
        "[quickresto-sync] выбор подключения:",
        error instanceof Error ? error.message : error,
      );
    }
    // Give each queue its scheduled turn, with at most one active provider
    // workload per tick. Shifts can use a turn whose assigned queue is idle.
    let lane = -1;
    if (!nomenclatureBusy) {
      const rotation = await asLooseDb(createAdminClient()).rpc(
        "sales_next_worker_lane",
      );
      if (
        rotation.error ||
        !Number.isInteger(rotation.data) ||
        Number(rotation.data) < 0 ||
        Number(rotation.data) > 10
      )
        throw new Error("Не удалось выбрать очередь");
      lane = Number(rotation.data);
    }
    const started = Date.now();
    if (lane === 10) {
      // Фото блюд из Quick Resto: один ход до ~25 секунд (dish-photo-sync.ts).
      try {
        const r = await processDishPhotos();
        if (!r.idle) {
          dishPhotoRuns++;
          dishPhotosDownloaded += r.downloaded;
          if (r.error) dishPhotoErrors++;
        }
      } catch (error) {
        dishPhotoErrors++;
        console.error(
          "[dish-photos] ход очереди:",
          error instanceof Error ? error.message : error,
        );
      }
    } else if (lane === 9) {
      while (Date.now() - started < 25000 && supplySlices < 100) {
        try {
          const r = await processSupplyRead();
          if (r.idle) break;
          supplySlices++;
          if (r.error) {
            supplyErrors++;
            break;
          }
        } catch {
          supplyErrors++;
          break;
        }
      }
    } else if (lane === 8) {
      while (Date.now() - started < 25000 && guestSlices < 100) {
        try {
          const r = await processGuestRead();
          if (r.idle) break;
          guestSlices++;
          if (r.error) {
            guestErrors++;
            break;
          }
        } catch {
          guestErrors++;
          break;
        }
      }
    } else if (lane === 7) {
      while (Date.now() - started < 25000 && nativeFinanceSlices < 100) {
        try {
          const r = await processNativeFinance();
          if (r.idle) break;
          nativeFinanceSlices++;
          if (r.error) {
            nativeFinanceErrors++;
            break;
          }
        } catch {
          nativeFinanceErrors++;
          break;
        }
      }
    } else if (lane === 6) {
      while (Date.now() - started < 25000 && cashMovementSlices < 100) {
        try {
          const r = await processCashMovement();
          if (r.idle) break;
          cashMovementSlices++;
          if (r.error) {
            cashMovementErrors++;
            break;
          }
        } catch {
          cashMovementErrors++;
          break;
        }
      }
    } else if (lane === 5) {
      while (Date.now() - started < 25000 && cashControlSlices < 100) {
        try {
          const r = await processCashControl();
          if (r.idle) break;
          cashControlSlices++;
          if (r.error) {
            cashControlErrors++;
            break;
          }
        } catch {
          cashControlErrors++;
          break;
        }
      }
    } else if (lane === 4) {
      while (Date.now() - started < 25000 && settlementSlices < 100) {
        try {
          const r = await processSettlement();
          if (r.idle) break;
          settlementSlices++;
          if (r.error) {
            settlementErrors++;
            break;
          }
        } catch {
          settlementErrors++;
          break;
        }
      }
    } else if (lane === 3) {
      try {
        const r = await processStockWriteoff();
        if (!r.idle) stockSlices++;
        if (r.error) stockErrors++;
      } catch {
        stockErrors++;
      }
    } else if (lane === 2) {
      try {
        const r = await processAdditionalReport();
        if (!r.idle) additionalReports++;
        if (r.error) additionalErrors++;
      } catch {
        additionalErrors++;
      }
      // Несколько дней за проход: открытый день встаёт в очередь с каждой
      // загрузкой чеков (~15 мин) по каждому подразделению, и по одному дню
      // за проход очередь не успевала до закрытых дней.
      for (let i = 0; i < 6 && Date.now() - started < 25000; i++) {
        try {
          const r = await processUpsellDay();
          if (r.idle) break;
          additionalReports++;
          if (r.error) {
            additionalErrors++;
            break;
          }
        } catch {
          additionalErrors++;
          break;
        }
      }
    } else if (lane === 1) {
      try {
        const r = await processStatisticsReport();
        if (!r.idle) monthReports++;
        if (r.error) monthReportErrors++;
      } catch {
        monthReportErrors++;
      }
    }
    const otherWork = [
      monthReports, monthReportErrors,
      additionalReports, additionalErrors,
      stockSlices, stockErrors,
      settlementSlices, settlementErrors,
      cashControlSlices, cashControlErrors,
      cashMovementSlices, cashMovementErrors,
      nativeFinanceSlices, nativeFinanceErrors,
      guestSlices, guestErrors,
      supplySlices, supplyErrors,
      dishPhotoRuns, dishPhotoErrors,
    ].some(Boolean);
    if (!nomenclatureBusy && (lane === 0 || !otherWork)) {
      while (Date.now() - started < 25000 && slices < 100) {
        const r = await runOneSlice();
        if (r.idle) break;
        slices++;
        if (r.error) {
          failed++;
          break;
        }
      }
    }
    return NextResponse.json({
      queued,
      slices,
      failed,
      monthReports,
      monthReportErrors,
      additionalReports,
      additionalErrors,
      stockSlices,
      stockErrors,
      settlementSlices,
      settlementErrors,
      cashControlSlices,
      cashControlErrors,
      cashMovementSlices,
      cashMovementErrors,
      nativeFinanceSlices,
      nativeFinanceErrors,
      guestSlices,
      guestErrors,
      supplySlices,
      supplyErrors,
      supplyPending,
      nomenclatureRuns,
      nomenclatureErrors,
      dishPhotoRuns,
      dishPhotoErrors,
      dishPhotosDownloaded,
    });
  } catch {
    return NextResponse.json(
      { error: "Не удалось обработать очередь смен" },
      { status: 500 },
    );
  }
}

import { and, eq } from "drizzle-orm";

import { DomainError } from "@/lib/domain-error";
import {
  resolveOccurrence,
  type DayDirection,
  type DayRule,
} from "@/lib/important-days";
import { db, type DbClient } from "@/server/db/client";
import { importantDays } from "@/server/db/schema";

/** 名称去空白后的最大长度（与产品 spec 一致）。 */
const TITLE_MAX_LENGTH = 50;

/** 公历日期格式（真实日期另做日历校验）。 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 路由 / 表单传入的 id 可能不是 UUID，提前拦截并按「不存在」处理。 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 列表展示用的「重要日子」视图：原始规则 + 最近一次发生的信息。 */
export interface ImportantDayView {
  id: string;
  title: string;
  pinned: boolean;
  isLunar: boolean;
  repeat: "none" | "yearly";
  /** 公历锚点（非农历）；农历条目为 null。 */
  anchorDate: string | null;
  lunarMonth: number | null;
  lunarDay: number | null;
  direction: DayDirection;
  /** 相对 `today` 的最近一次发生日（公历 `YYYY-MM-DD`）。 */
  occurrenceDate: string;
  /** 距今天的天数，恒为非负。 */
  days: number;
}

/** 创建 / 更新入参：公历与农历两组字段由 service 归一。 */
export interface ImportantDayInput {
  title: string;
  date: string | null;
  isLunar: boolean;
  lunarMonth: number | null;
  lunarDay: number | null;
  repeat: "none" | "yearly";
  pinned: boolean;
}

/** 校验并归一后的落库字段（形状满足 important_days 的 CHECK 约束）。 */
interface NormalizedDay {
  title: string;
  date: string | null;
  isLunar: boolean;
  lunarMonth: number | null;
  lunarDay: number | null;
  repeat: "none" | "yearly";
  pinned: boolean;
}

type ImportantDayRow = typeof importantDays.$inferSelect;

/** 名称去空白后 1–50 字符。 */
function validateTitle(value: unknown): string {
  const title = typeof value === "string" ? value.trim() : "";

  if (!title) {
    throw new DomainError("请填写名称", "title", { key: "titleRequired" });
  }
  if (title.length > TITLE_MAX_LENGTH) {
    throw new DomainError(
      `名称不能超过 ${TITLE_MAX_LENGTH} 个字符`,
      "title",
      { key: "titleTooLong", params: { max: TITLE_MAX_LENGTH } },
    );
  }

  return title;
}

/**
 * 公历日期必须是 `YYYY-MM-DD` 且为真实存在的日历日（拒绝 2026-02-30 之类）。
 */
function validateSolarDate(value: unknown): string {
  const date = typeof value === "string" ? value.trim() : "";

  if (!DATE_PATTERN.test(date)) {
    throw new DomainError("日期格式不正确", "date", { key: "invalidDate" });
  }

  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  const isRealDate =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month! - 1 &&
    parsed.getUTCDate() === day;

  if (!isRealDate) {
    throw new DomainError("日期格式不正确", "date", { key: "invalidDate" });
  }

  return date;
}

/** 农历月（1–12）/ 日（1–30）必须是范围内的整数。 */
function validateLunarPart(
  value: unknown,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > max
  ) {
    throw new DomainError("农历月日不在有效范围", "form", {
      key: "invalidLunarDay",
    });
  }

  return value;
}

/**
 * 归一化入参并落库前校验。
 *
 * - `isLunar=true`：强制 `repeat="yearly"`、`date=null`，只校验农历月日；
 * - `isLunar=false`：必须有真实公历日期，农历字段一律置空；
 * - `pinned` 统一转布尔。
 */
function normalizeInput(input: ImportantDayInput): NormalizedDay {
  const title = validateTitle(input?.title);
  const pinned = Boolean(input?.pinned);

  if (input?.isLunar) {
    return {
      title,
      date: null,
      isLunar: true,
      lunarMonth: validateLunarPart(input.lunarMonth, 12),
      lunarDay: validateLunarPart(input.lunarDay, 30),
      repeat: "yearly",
      pinned,
    };
  }

  return {
    title,
    date: validateSolarDate(input?.date),
    isLunar: false,
    lunarMonth: null,
    lunarDay: null,
    repeat: input?.repeat === "yearly" ? "yearly" : "none",
    pinned,
  };
}

/** 数据库行 -> 可跨边界的视图；发生日由纯函数 `resolveOccurrence` 计算。 */
function toView(row: ImportantDayRow, today: string): ImportantDayView {
  const rule: DayRule = {
    date: row.date ?? null,
    isLunar: row.isLunar,
    lunarMonth: row.lunarMonth ?? null,
    lunarDay: row.lunarDay ?? null,
    repeat: row.repeat,
  };
  const occurrence = resolveOccurrence(rule, today);

  return {
    id: row.id,
    title: row.title,
    pinned: row.pinned,
    isLunar: row.isLunar,
    repeat: row.repeat,
    anchorDate: row.date ?? null,
    lunarMonth: row.lunarMonth ?? null,
    lunarDay: row.lunarDay ?? null,
    direction: occurrence.direction,
    occurrenceDate: occurrence.date,
    days: occurrence.days,
  };
}

/**
 * 排序：置顶优先；非置顶中 upcoming 在前（days ASC），elapsed 在后（days DESC）。
 *
 * 单用户行数很小，直接在内存排序，不写复杂 SQL。
 */
function compareViews(a: ImportantDayView, b: ImportantDayView): number {
  if (a.pinned !== b.pinned) {
    return a.pinned ? -1 : 1;
  }
  if (a.direction !== b.direction) {
    return a.direction === "upcoming" ? -1 : 1;
  }

  return a.direction === "upcoming" ? a.days - b.days : b.days - a.days;
}

/** id 非法时统一按「不存在」处理，避免数据库抛出 UUID 语法错误。 */
function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** 写操作归属断言失败的统一错误。 */
function notFoundError(): DomainError {
  return new DomainError("该日子不存在或已被删除", "form", {
    key: "notFound",
  });
}

/**
 * 列出本人的全部重要日子，并按产品规则排序（limit 在排序后截断）。
 *
 * `today` 由调用方按 Asia/Shanghai 口径传入；查询只按 ownerId 过滤，
 * 不向他人泄露数据。
 */
export async function listImportantDays(
  params: { userId: string; today: string; limit?: number },
  client: DbClient = db,
): Promise<ImportantDayView[]> {
  const { userId, today, limit } = params;

  const rows = await client
    .select()
    .from(importantDays)
    .where(eq(importantDays.ownerId, userId));

  const views = rows
    .map((row) => toView(row, today))
    .sort(compareViews);

  return limit === undefined ? views : views.slice(0, limit);
}

/** 创建重要日子，返回新行 id。 */
export async function createImportantDay(
  params: { userId: string } & ImportantDayInput,
  client: DbClient = db,
): Promise<string> {
  const { userId, ...input } = params;
  const values = normalizeInput(input);

  const [row] = await client
    .insert(importantDays)
    .values({ ownerId: userId, ...values })
    .returning({ id: importantDays.id });

  if (!row) {
    throw new Error("important day insert returned no row");
  }

  return row.id;
}

/** 更新本人的重要日子；不存在 / 非本人统一抛 notFound。 */
export async function updateImportantDay(
  params: { userId: string; id: string } & ImportantDayInput,
  client: DbClient = db,
): Promise<void> {
  const { userId, id, ...input } = params;
  const values = normalizeInput(input);

  if (!isUuid(id)) {
    throw notFoundError();
  }

  const [row] = await client
    .update(importantDays)
    .set({ ...values, updatedAt: new Date() })
    .where(
      and(eq(importantDays.id, id), eq(importantDays.ownerId, userId)),
    )
    .returning({ id: importantDays.id });

  if (!row) {
    throw notFoundError();
  }
}

/** 删除本人的重要日子；不存在 / 非本人统一抛 notFound。 */
export async function deleteImportantDay(
  params: { userId: string; id: string },
  client: DbClient = db,
): Promise<void> {
  const { userId, id } = params;

  if (!isUuid(id)) {
    throw notFoundError();
  }

  const [row] = await client
    .delete(importantDays)
    .where(
      and(eq(importantDays.id, id), eq(importantDays.ownerId, userId)),
    )
    .returning({ id: importantDays.id });

  if (!row) {
    throw notFoundError();
  }
}

/** 置顶 / 取消置顶本人的重要日子；不存在 / 非本人统一抛 notFound。 */
export async function toggleImportantDayPinned(
  params: { userId: string; id: string; pinned: boolean },
  client: DbClient = db,
): Promise<void> {
  const { userId, id, pinned } = params;

  if (!isUuid(id)) {
    throw notFoundError();
  }

  const [row] = await client
    .update(importantDays)
    .set({ pinned: Boolean(pinned), updatedAt: new Date() })
    .where(
      and(eq(importantDays.id, id), eq(importantDays.ownerId, userId)),
    )
    .returning({ id: importantDays.id });

  if (!row) {
    throw notFoundError();
  }
}

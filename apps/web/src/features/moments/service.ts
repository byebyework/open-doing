import { and, eq } from "drizzle-orm";

import { DomainError } from "@/lib/domain-error";
import {
  resolveOccurrence,
  type MomentCycle,
  type MomentDirection,
  type MomentMode,
} from "@/lib/moment-occurrence";
import { todayInShanghai } from "@/lib/today";
import { db, type DbClient } from "@/server/db/client";
import { moments } from "@/server/db/schema";

/** 名称去空白后的最大长度（与产品 spec 一致）。 */
const TITLE_MAX_LENGTH = 50;

/** 公历日期格式（真实日期另做日历校验）。 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 路由 / 表单传入的 id 可能不是 UUID，提前拦截并按「不存在」处理。 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MOMENT_MODES = ["count_up", "countdown", "periodic"] as const;
const MOMENT_CYCLES = ["daily", "weekly", "monthly", "yearly"] as const;

/** 列表展示用的「时刻」视图：原始规则 + 最近一次发生的信息。 */
export interface MomentView {
  id: string;
  title: string;
  pinned: boolean;
  mode: MomentMode;
  cycle: MomentCycle | null;
  /** 锚点日：count_up=起始日；countdown=目标日；yearly 周期的月日来源。 */
  anchorDate: string;
  weekday: number | null;
  dayOfMonth: number | null;
  direction: MomentDirection;
  /** 相对 `today` 的最近一次发生日（公历 `YYYY-MM-DD`）。 */
  occurrenceDate: string;
  /** 距今天的天数，恒为非负。 */
  days: number;
}

/** 创建 / 更新入参：周期子字段由 service 按 mode 归一。 */
export interface MomentInput {
  title: string;
  mode: MomentMode;
  anchorDate: string;
  cycle: MomentCycle | null;
  weekday: number | null;
  dayOfMonth: number | null;
  pinned: boolean;
}

/** 校验并归一后的落库字段（形状满足 moments 的 CHECK 约束）。 */
interface NormalizedMoment {
  title: string;
  mode: MomentMode;
  anchorDate: string;
  cycle: MomentCycle | null;
  weekday: number | null;
  dayOfMonth: number | null;
  pinned: boolean;
}

type MomentRow = typeof moments.$inferSelect;

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
 * 锚点日必须是 `YYYY-MM-DD` 且为真实存在的日历日（拒绝 2026-02-30 之类）。
 */
function validateAnchorDate(value: unknown): string {
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

function isMomentMode(value: unknown): value is MomentMode {
  return (
    typeof value === "string" &&
    (MOMENT_MODES as readonly string[]).includes(value)
  );
}

function isMomentCycle(value: unknown): value is MomentCycle {
  return (
    typeof value === "string" &&
    (MOMENT_CYCLES as readonly string[]).includes(value)
  );
}

/** 整数且落在闭区间 `[min, max]`。 */
function isIntegerInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

/**
 * 归一化入参并落库前校验。
 *
 * - count_up：锚点日不得晚于今天（未来语义属于倒计时）；
 * - periodic：cycle 必填，weekly / monthly 分别校验并保留各自的子字段，
 *   daily / yearly 只保留 cycle；yearly 的月日取自 anchorDate；
 * - 其余（count_up / countdown）：cycle / weekday / dayOfMonth 一律置空。
 *
 * 返回值从已知字段重建，客户端夹带的额外键（含 ownership）在此被丢弃。
 */
function normalizeInput(input: MomentInput, today: string): NormalizedMoment {
  const title = validateTitle(input?.title);
  const anchorDate = validateAnchorDate(input?.anchorDate);
  const pinned = Boolean(input?.pinned);
  const mode = input?.mode;

  if (!isMomentMode(mode)) {
    // 模式由客户端提交，未知值按「计时模式不完整」拒绝，避免落到 CHECK 约束的内部错误。
    throw new DomainError("计时模式不完整", "form", { key: "invalidCycle" });
  }

  if (mode === "count_up" && anchorDate > today) {
    throw new DomainError("正计时的起始日期不能晚于今天", "date", {
      key: "anchorInFuture",
    });
  }

  if (mode === "periodic") {
    const cycle = input?.cycle;

    if (!isMomentCycle(cycle)) {
      throw new DomainError("计时模式不完整", "form", { key: "invalidCycle" });
    }

    if (cycle === "weekly") {
      if (!isIntegerInRange(input?.weekday, 0, 6)) {
        throw new DomainError("星期不在有效范围", "form", {
          key: "invalidWeekday",
        });
      }

      return {
        title,
        mode,
        anchorDate,
        cycle,
        weekday: input.weekday,
        dayOfMonth: null,
        pinned,
      };
    }

    if (cycle === "monthly") {
      if (!isIntegerInRange(input?.dayOfMonth, 1, 31)) {
        throw new DomainError("日期不在有效范围", "form", {
          key: "invalidDayOfMonth",
        });
      }

      return {
        title,
        mode,
        anchorDate,
        cycle,
        weekday: null,
        dayOfMonth: input.dayOfMonth,
        pinned,
      };
    }

    return {
      title,
      mode,
      anchorDate,
      cycle,
      weekday: null,
      dayOfMonth: null,
      pinned,
    };
  }

  return {
    title,
    mode,
    anchorDate,
    cycle: null,
    weekday: null,
    dayOfMonth: null,
    pinned,
  };
}

/** 数据库行 -> 可跨边界的视图；发生日由纯函数 `resolveOccurrence` 计算。 */
function toView(row: MomentRow, today: string): MomentView {
  const occurrence = resolveOccurrence(
    {
      mode: row.mode,
      anchorDate: row.anchorDate,
      cycle: row.cycle ?? null,
      weekday: row.weekday ?? null,
      dayOfMonth: row.dayOfMonth ?? null,
    },
    today,
  );

  return {
    id: row.id,
    title: row.title,
    pinned: row.pinned,
    mode: row.mode,
    cycle: row.cycle ?? null,
    anchorDate: row.anchorDate,
    weekday: row.weekday ?? null,
    dayOfMonth: row.dayOfMonth ?? null,
    direction: occurrence.direction,
    occurrenceDate: occurrence.date,
    days: occurrence.days,
  };
}

/**
 * 排序：置顶优先；非置顶中 today / upcoming 在前（days ASC，today 的 0 天自然最前），
 * elapsed 在后（days DESC）。
 *
 * 单用户行数很小，直接在内存排序，不写复杂 SQL。
 */
function compareViews(a: MomentView, b: MomentView): number {
  if (a.pinned !== b.pinned) {
    return a.pinned ? -1 : 1;
  }

  const aElapsed = a.direction === "elapsed";
  const bElapsed = b.direction === "elapsed";

  if (aElapsed !== bElapsed) {
    return aElapsed ? 1 : -1;
  }

  return aElapsed ? b.days - a.days : a.days - b.days;
}

/** id 非法时统一按「不存在」处理，避免数据库抛出 UUID 语法错误。 */
function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** 写操作归属断言失败的统一错误。 */
function notFoundError(): DomainError {
  return new DomainError("该时刻不存在或已被删除", "form", {
    key: "notFound",
  });
}

/**
 * 列出本人的全部时刻，并按产品规则排序（limit 在排序后截断）。
 *
 * `today` 由调用方按 Asia/Shanghai 口径传入；查询只按 ownerId 过滤，
 * 不向他人泄露数据。
 */
export async function listMoments(
  params: { userId: string; today: string; limit?: number },
  client: DbClient = db,
): Promise<MomentView[]> {
  const { userId, today, limit } = params;

  const rows = await client
    .select()
    .from(moments)
    .where(eq(moments.ownerId, userId));

  const views = rows.map((row) => toView(row, today)).sort(compareViews);

  return limit === undefined ? views : views.slice(0, limit);
}

/** 创建时刻，返回新行 id。 */
export async function createMoment(
  params: { userId: string } & MomentInput,
  client: DbClient = db,
): Promise<string> {
  const { userId, ...input } = params;
  const values = normalizeInput(input, todayInShanghai());

  const [row] = await client
    .insert(moments)
    .values({ ownerId: userId, ...values })
    .returning({ id: moments.id });

  if (!row) {
    throw new Error("moment insert returned no row");
  }

  return row.id;
}

/** 更新本人的时刻；不存在 / 非本人统一抛 notFound。 */
export async function updateMoment(
  params: { userId: string; id: string } & MomentInput,
  client: DbClient = db,
): Promise<void> {
  const { userId, id, ...input } = params;
  const values = normalizeInput(input, todayInShanghai());

  if (!isUuid(id)) {
    throw notFoundError();
  }

  const [row] = await client
    .update(moments)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(moments.id, id), eq(moments.ownerId, userId)))
    .returning({ id: moments.id });

  if (!row) {
    throw notFoundError();
  }
}

/** 删除本人的时刻；不存在 / 非本人统一抛 notFound。 */
export async function deleteMoment(
  params: { userId: string; id: string },
  client: DbClient = db,
): Promise<void> {
  const { userId, id } = params;

  if (!isUuid(id)) {
    throw notFoundError();
  }

  const [row] = await client
    .delete(moments)
    .where(and(eq(moments.id, id), eq(moments.ownerId, userId)))
    .returning({ id: moments.id });

  if (!row) {
    throw notFoundError();
  }
}

/** 置顶 / 取消置顶本人的时刻；不存在 / 非本人统一抛 notFound。 */
export async function toggleMomentPinned(
  params: { userId: string; id: string; pinned: boolean },
  client: DbClient = db,
): Promise<void> {
  const { userId, id, pinned } = params;

  if (!isUuid(id)) {
    throw notFoundError();
  }

  const [row] = await client
    .update(moments)
    .set({ pinned: Boolean(pinned), updatedAt: new Date() })
    .where(and(eq(moments.id, id), eq(moments.ownerId, userId)))
    .returning({ id: moments.id });

  if (!row) {
    throw notFoundError();
  }
}

"use server";

import type { ActionResult } from "@/features/auth/actions";
import { generateRegistrationCodes } from "@/features/auth/registration-codes";
import { getCurrentUser } from "@/features/auth/session";
import { standardFailuresForRequest } from "@/lib/action-failure";
import { db } from "@/server/db/client";

import { AdminError, setUserAdmin, setUserDisabled } from "./service";

/** 注册码次数上限的合法区间（与新增注册码表单一致）。 */
const MAX_USES_MIN = 1;
const MAX_USES_MAX = 1000;

/**
 * 目标用户 id 必须是 UUID：
 * - 服务端的 `users.id` 是 PG uuid 列，非 UUID 字符串会在查询时抛数据库错误；
 * - 提前拦截并按 targetNotFound 语义返回，避免把内部错误暴露给客户端。
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Failure = { ok: false; errors: Record<string, string> };

/**
 * AdminError -> 结构化失败：按请求语言翻译 admin 命名空间文案，
 * 落 `field ?? "form"`（与其它 feature 的 toFailure 语义一致）。
 * 未知错误只回通用 actionFailed，避免泄露数据库 / 内部细节。
 */
async function toFailure(error: unknown): Promise<Failure> {
  const failures = await standardFailuresForRequest();

  if (error instanceof AdminError) {
    const key = error.i18n?.key ?? "actionFailed";
    const failure = failures.custom(`admin.${key}`, error.i18n?.params);
    return {
      ok: false,
      errors: { [error.field ?? "form"]: failure.errors.form! },
    };
  }

  console.error("[admin] Server Action 执行失败", error);
  return failures.custom("admin.actionFailed");
}

/**
 * 新增一个注册码（码值由系统生成，可被使用 `maxUses` 次）。
 *
 * 每个 Server Action 自行鉴权：非管理员一律结构化 forbidden（不 redirect，
 * 因为 action 的调用方需要拿到表单错误）。
 */
export async function createRegistrationCodeAction(
  maxUses: number,
): Promise<ActionResult<{ code: string }>> {
  const actor = await getCurrentUser();
  if (!actor?.isAdmin) {
    return (await standardFailuresForRequest()).forbidden();
  }

  // 表单值以字符串到达时先做 Number 归一再校验，避免 0 / NaN / 小数入库。
  const parsed =
    typeof maxUses === "number" || typeof maxUses === "string"
      ? Number(maxUses)
      : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < MAX_USES_MIN || parsed > MAX_USES_MAX) {
    const failures = await standardFailuresForRequest();
    return {
      ok: false,
      errors: { maxUses: failures.custom("admin.adminMaxUsesRange").errors.form! },
    };
  }

  try {
    const [code] = await generateRegistrationCodes(1, db, parsed);
    if (!code) return toFailure(new Error("registration code was not created"));
    return { ok: true, data: { code } };
  } catch (error) {
    return toFailure(error);
  }
}

/** 禁用 / 解禁目标用户（不允许操作自己）。 */
export async function setUserDisabledAction(
  targetId: string,
  disabled: boolean,
): Promise<ActionResult<true>> {
  const actor = await getCurrentUser();
  if (!actor?.isAdmin) {
    return (await standardFailuresForRequest()).forbidden();
  }

  if (typeof targetId !== "string" || !UUID_PATTERN.test(targetId)) {
    return (await standardFailuresForRequest()).custom("admin.targetNotFound");
  }
  if (typeof disabled !== "boolean") {
    return (await standardFailuresForRequest()).custom("admin.actionFailed");
  }

  try {
    await setUserDisabled(targetId, disabled, actor.id);
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error);
  }
}

/** 授予 / 撤销目标用户的管理员身份（不允许操作自己）。 */
export async function setUserAdminAction(
  targetId: string,
  admin: boolean,
): Promise<ActionResult<true>> {
  const actor = await getCurrentUser();
  if (!actor?.isAdmin) {
    return (await standardFailuresForRequest()).forbidden();
  }

  if (typeof targetId !== "string" || !UUID_PATTERN.test(targetId)) {
    return (await standardFailuresForRequest()).custom("admin.targetNotFound");
  }
  if (typeof admin !== "boolean") {
    return (await standardFailuresForRequest()).custom("admin.actionFailed");
  }

  try {
    await setUserAdmin(targetId, admin, actor.id);
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error);
  }
}

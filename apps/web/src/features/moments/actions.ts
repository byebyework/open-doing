"use server";

import type { ActionResult } from "@/features/auth/actions";
import { requireUser } from "@/features/auth/session";
import { standardFailuresForRequest } from "@/lib/action-failure";
import { DomainError } from "@/lib/domain-error";
import { todayInShanghai } from "@/lib/today";

import {
  createMoment,
  deleteMoment,
  listMoments,
  toggleMomentPinned,
  updateMoment,
  type MomentInput,
  type MomentView,
} from "./service";

type Failure = Extract<ActionResult<never>, { ok: false }>;

/**
 * 领域错误 -> 字段错误；未知错误只返回通用提示，避免泄露内部信息。
 *
 * 复用 auth 的 `ActionResult` 契约，「时刻」所有 Server Action 返回值一致。
 */
async function toFailure(error: unknown): Promise<Failure> {
  if (error instanceof DomainError) {
    // service 层存的是裸 key（如 titleRequired），这里补上 moments 命名空间；
    // 无 i18n 通道时回退 message（zh 兜底）。
    if (error.i18n) {
      const failures = await standardFailuresForRequest();
      return {
        ok: false,
        errors: {
          [error.field ?? "form"]: failures
            .custom(`moments.${error.i18n.key}`, error.i18n.params).errors.form!,
        },
      };
    }
    return { ok: false, errors: { [error.field ?? "form"]: error.message } };
  }

  console.error("[moments] Server Action 执行失败", error);
  return (await standardFailuresForRequest()).unexpected();
}

/** 写操作后按 id 回读最新视图（查询仍只按本人数据，不泄露他人条目）。 */
async function readView(userId: string, id: string): Promise<MomentView> {
  const views = await listMoments({ userId, today: todayInShanghai() });
  const view = views.find((item) => item.id === id);

  if (!view) {
    throw new Error("moment read-back returned no row");
  }

  return view;
}

/**
 * 创建时刻。
 *
 * `requireUser()` 在 try 之外调用：未登录时 `redirect()` 抛出的
 * NEXT_REDIRECT 必须继续向上冒泡，不能被错误映射吞掉。
 */
export async function createMomentAction(
  input: MomentInput,
): Promise<ActionResult<MomentView>> {
  const user = await requireUser();

  try {
    const id = await createMoment({ ...input, userId: user.id });
    return { ok: true, data: await readView(user.id, id) };
  } catch (error) {
    return toFailure(error);
  }
}

/** 更新本人的时刻，返回回读后的最新视图。 */
export async function updateMomentAction(
  id: string,
  input: MomentInput,
): Promise<ActionResult<MomentView>> {
  const user = await requireUser();

  try {
    await updateMoment({ ...input, userId: user.id, id });
    return { ok: true, data: await readView(user.id, id) };
  } catch (error) {
    return toFailure(error);
  }
}

/** 删除本人的时刻。 */
export async function deleteMomentAction(
  id: string,
): Promise<ActionResult<null>> {
  const user = await requireUser();

  try {
    await deleteMoment({ userId: user.id, id });
    return { ok: true, data: null };
  } catch (error) {
    return toFailure(error);
  }
}

/** 置顶 / 取消置顶本人的时刻。 */
export async function toggleMomentPinnedAction(
  id: string,
  pinned: boolean,
): Promise<ActionResult<null>> {
  const user = await requireUser();

  try {
    await toggleMomentPinned({ userId: user.id, id, pinned });
    return { ok: true, data: null };
  } catch (error) {
    return toFailure(error);
  }
}

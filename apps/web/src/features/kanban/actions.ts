"use server";

import type { ActionResult } from "@/features/auth/actions";
import { getCurrentUser, requireUser } from "@/features/auth/session";
import { getMembership } from "@/features/teams/permissions";
import { getTeamBySlug } from "@/features/teams/service";
import { todayInShanghai } from "@/lib/today";

import {
  getOlderDonePersonalTasks,
  getOlderDoneTeamTasks,
  type KanbanCardItem,
} from "./service";

type Failure = Extract<ActionResult<never>, { ok: false }>;

/**
 * 团队不存在与非成员共用同一文案：不区分「无此团队」与「无权查看」，
 * 避免通过错误信息探测团队 slug 是否存在。
 */
const NO_TEAM_ACCESS: Failure = {
  ok: false,
  errors: { form: "没有权限查看该团队" },
};

/** 未知错误只返回通用提示，避免泄露内部信息（与其它 feature 的 action 一致）。 */
function toFailure(error: unknown): Failure {
  console.error("[kanban] Server Action 执行失败", error);
  return { ok: false, errors: { form: "操作失败，请稍后重试" } };
}

/**
 * 看板「查看更早的已完成」展开取数：返回 7 天窗口外、按 updatedAt 降序的 done 卡。
 *
 * - personal 分支走 `requireUser()`（未登录重定向到 /login，与受保护页面同语义）；
 * - team 分支走 `getCurrentUser()`，未登录 / 团队不存在 / 非成员一律返回
 *   `{ ok:false, errors:{ form:"没有权限查看该团队" } }`——Server Action 里
 *   `notFound()` 不可用，也不泄露团队是否存在；
 * - `today` 在 action 内由 `todayInShanghai()` 计算，日期口径单一来源。
 */
export async function getOlderDoneTasksAction(
  input: { spaceType: "personal" } | { spaceType: "team"; teamSlug: string },
): Promise<ActionResult<KanbanCardItem[]>> {
  // Server Action 入参在传输层可被篡改（null / 缺字段），先做窄化守卫，
  // 避免下方解引用抛出未捕获 TypeError；文案与授权失败区分开。
  if (!input || (input.spaceType !== "personal" && input.spaceType !== "team")) {
    return { ok: false, errors: { form: "操作失败，请稍后重试" } };
  }

  if (input.spaceType === "personal") {
    // requireUser() 在 try 之外：未登录时 redirect() 抛出的 NEXT_REDIRECT
    // 必须继续冒泡，不能被错误映射吞掉。
    const user = await requireUser();

    try {
      return {
        ok: true,
        data: await getOlderDonePersonalTasks(user.id, todayInShanghai()),
      };
    } catch (error) {
      return toFailure(error);
    }
  }

  const user = await getCurrentUser();
  if (!user) return NO_TEAM_ACCESS;

  try {
    const team = await getTeamBySlug(input.teamSlug);
    if (!team) return NO_TEAM_ACCESS;

    const membership = await getMembership(team.id, user.id);
    if (!membership) return NO_TEAM_ACCESS;

    return {
      ok: true,
      data: await getOlderDoneTeamTasks(team.id, todayInShanghai()),
    };
  } catch (error) {
    return toFailure(error);
  }
}

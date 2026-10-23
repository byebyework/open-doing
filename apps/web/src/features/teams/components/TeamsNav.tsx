import { NavSection } from "@/components/layout/NavSection";
import { getCurrentUser } from "@/features/auth/session";
import { listReceivedInvites } from "../invites/service";
import { listTeamsForUser } from "../service";
import { TeamsNavItem } from "./TeamsNavItem";

/**
 * 团队空间导航（T 轨道接线）。
 *
 * 未登录返回 null；已登录渲染「我的团队」分组（团队项 + 创建入口），
 * 以及「账号」分组的待处理邀请入口（含未处理数角标，对照原型）。
 * 侧栏同时在个人空间与团队上下文展示本分组（与原型一致），
 * `(dashboard)/layout.tsx` 只 import 本文件，T 轨道不得修改布局。
 */
export async function TeamsNav() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [teams, received] = await Promise.all([
    listTeamsForUser(user.id),
    listReceivedInvites(user.id),
  ]);
  const pendingCount = received.filter((view) => view.invite.status === "pending").length;

  return (
    <>
      <NavSection title="我的团队">
        {teams.map((team) => (
          <TeamsNavItem key={team.id} href={`/teams/${team.slug}/settings`}>
            {team.name}
          </TeamsNavItem>
        ))}
        <TeamsNavItem href="/teams/new">＋ 创建团队</TeamsNavItem>
      </NavSection>

      <NavSection title="账号">
        <TeamsNavItem
          href="/invites"
          trailing={
            pendingCount > 0 ? (
              <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-[#ff5757] px-1 text-[11px] font-bold text-white">
                {pendingCount}
              </span>
            ) : undefined
          }
        >
          待处理邀请
        </TeamsNavItem>
      </NavSection>
    </>
  );
}

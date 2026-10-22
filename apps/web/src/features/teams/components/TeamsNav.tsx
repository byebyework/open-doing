import { NavSection } from "@/components/layout/NavSection";
import { getCurrentUser } from "@/features/auth/session";
import { listTeamsForUser } from "../service";
import { TeamsNavItem } from "./TeamsNavItem";

/**
 * 团队空间导航（T 轨道接线）。
 *
 * 未登录返回 null；已登录渲染「我的团队」分组（团队项 + 创建入口）。
 * 侧栏同时在个人空间与团队上下文展示本分组（与原型一致），
 * `(dashboard)/layout.tsx` 只 import 本文件，T 轨道不得修改布局。
 */
export async function TeamsNav() {
  const user = await getCurrentUser();
  if (!user) return null;

  const teams = await listTeamsForUser(user.id);

  return (
    <NavSection title="我的团队">
      {teams.map((team) => (
        <TeamsNavItem key={team.id} href={`/teams/${team.slug}/settings`}>
          {team.name}
        </TeamsNavItem>
      ))}
      <TeamsNavItem href="/teams/new">＋ 创建团队</TeamsNavItem>
    </NavSection>
  );
}

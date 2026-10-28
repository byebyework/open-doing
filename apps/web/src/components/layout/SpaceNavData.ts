import { getCurrentUser } from "@/features/auth/session";
import { listReceivedInvites } from "@/features/teams/invites/service";
import { listTeamsForUser } from "@/features/teams/service";

/** 侧栏 / 移动 Drawer 共用的导航数据（可序列化，供 client 组件消费）。 */
export interface SpaceNavData {
  /** 当前用户所属团队（按创建时间升序）。 */
  teams: { slug: string; name: string }[];
  /** 待处理邀请数（仅统计 status === "pending"）。 */
  pendingInviteCount: number;
  /** 是否已登录；未登录时导航整体不渲染。 */
  loggedIn: boolean;
}

/**
 * 一次取齐导航所需数据。
 *
 * 布局层调用一次，分别交给桌面侧栏（`SpaceNav`）与移动 Drawer（Task 6）
 * 渲染同一棵导航树，避免两处各查一次库。
 * 未登录返回空数据（`loggedIn: false`），由消费方短路为 null。
 */
export async function getSpaceNavData(): Promise<SpaceNavData> {
  const user = await getCurrentUser();
  if (!user) return { teams: [], pendingInviteCount: 0, loggedIn: false };

  const [teams, received] = await Promise.all([
    listTeamsForUser(user.id),
    listReceivedInvites(user.id),
  ]);

  return {
    teams: teams.map(({ slug, name }) => ({ slug, name })),
    pendingInviteCount: received.filter(
      (view) => view.invite.status === "pending",
    ).length,
    loggedIn: true,
  };
}

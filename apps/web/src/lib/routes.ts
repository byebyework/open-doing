// 全站内部 href 的唯一出口。所有页面/组件需要内部跳转地址时都从这里取,
// 避免模板字符串散落各处导致路由改动时漏改。
// 纯函数,无依赖;不校验入参(slug/taskId 由调用方保证已编码安全)。

export type SpaceRef = string; // "personal" 或团队 slug
export type SpaceModule =
  | "dashboard"
  | "projects"
  | "kanban"
  | "calendar"
  | "analysis"
  | "settings";

export function spaceDashboardHref(spaceRef: SpaceRef): string {
  return `/space/${spaceRef}/dashboard`;
}

export function moduleHref(spaceRef: SpaceRef, module: SpaceModule): string {
  return `/space/${spaceRef}/${module}`;
}

export function personalTaskHref(taskId: string): string {
  return `/space/personal/tasks/${taskId}`;
}

export function personalProjectHref(projectSlug: string): string {
  return `/space/personal/projects/${projectSlug}`;
}

export function teamTaskHref(
  teamSlug: string,
  projectSlug: string,
  taskId: string,
): string {
  return `/space/${teamSlug}/projects/${projectSlug}/tasks/${taskId}`;
}

export function teamProjectHref(teamSlug: string, projectSlug: string): string {
  return `/space/${teamSlug}/projects/${projectSlug}`;
}

export function teamProjectNewHref(teamSlug: string): string {
  return `/space/${teamSlug}/projects/new`;
}

export function teamSettingsHref(teamSlug: string): string {
  return `/space/${teamSlug}/settings`;
}

/** 个人设置入口（系统级路由，不隶属于任何空间）。 */
export function personalSettingsHref(): string {
  return "/settings";
}

export function invitesHref(): string {
  return "/invites";
}

export function createTeamHref(): string {
  return "/teams/new";
}

export function joinTeamHref(): string {
  return "/teams/join";
}

/**
 * 从路径解析空间 ref（`personal` 或团队 slug）：首段为 `space` 时取第二段，
 * 缺省与一切非空间路由回退 `personal`。proxy（od_space cookie 写入）与
 * 侧栏 ambient 空间解析共用此口径。
 */
export function spaceRefFromPathname(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "space") return "personal";
  return segments[1] ?? "personal";
}

/**
 * 校验 ambient 空间 cookie 值（`od_space`）：只接受 `personal` 或当前用户
 * 所属团队 slug，其余（伪造 / 已解散团队）一律拒绝为 null——不信任任意
 * cookie 值，防止侧栏渲染未知团队。
 */
export function resolveAmbientSpaceRef(
  raw: string | null | undefined,
  teamSlugs: readonly string[],
): string | null {
  if (!raw) return null;
  if (raw === "personal") return "personal";
  return teamSlugs.includes(raw) ? raw : null;
}

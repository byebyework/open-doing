// 全站内部 href 的唯一出口。所有页面/组件需要内部跳转地址时都从这里取,
// 避免模板字符串散落各处导致路由改动时漏改。
// 纯函数,无依赖;不校验入参(slug/taskId 由调用方保证已编码安全)。

export type SpaceRef = string; // "personal" 或团队 slug
export type SpaceModule = "dashboard" | "kanban" | "calendar" | "analysis" | "settings";

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

export function invitesHref(): string {
  return "/invites";
}

export function createTeamHref(): string {
  return "/teams/new";
}

export function joinTeamHref(): string {
  return "/teams/join";
}

/**
 * 团队态「你是责任人」callout 的显示判定与文案。
 *
 * 原型文案以责任人视角写成，因此判定必须基于身份
 * （`assigneeId === currentUserId`），而不是权限位：`canAssign` 表示
 * 「可以改派」，owner/admin 也拥有该权限，用它判断会让非责任人看到
 * 「你是此任务的责任人」。
 *
 * 个人态永不渲染该 callout（个人空间没有团队语境文案）。
 */
export interface AssigneeCalloutInput {
  space: "personal" | "team";
  currentUserId?: string | null;
  assigneeId: string | null;
  /** 责任人本人是否可编辑任务内容；不可编辑时不宣称「可以编辑」。 */
  canEdit: boolean;
}

/** 是否显示团队态责任人 callout。 */
export function shouldShowAssigneeCallout({
  space,
  currentUserId,
  assigneeId,
}: AssigneeCalloutInput): boolean {
  return (
    space === "team" &&
    currentUserId != null &&
    assigneeId != null &&
    assigneeId === currentUserId
  );
}

/**
 * 责任人 callout 的文案 key（`tasks` 命名空间）；不可编辑时省略「可以编辑任务内容」。
 * 本模块保持纯函数、不依赖 hook，翻译由组件层用 `useTranslations("tasks")` 完成。
 */
export function assigneeCalloutKey(
  canEdit: boolean,
): "assigneeCalloutEditable" | "assigneeCallout" {
  return canEdit ? "assigneeCalloutEditable" : "assigneeCallout";
}

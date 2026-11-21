/** 项目字段限长常量（客户端安全：无副作用、无数据库依赖，表单可直连导入）。 */

/** 项目名称长度上限（与表单校验一致）。 */
export const PROJECT_NAME_MAX_LENGTH = 50;

/** 项目描述长度上限（与表单校验一致）。 */
export const PROJECT_DESCRIPTION_MAX_LENGTH = 500;

/** 项目一句话简述长度上限（与表单校验一致）。 */
export const PROJECT_SUMMARY_MAX_LENGTH = 100;

/** 里程碑名称长度上限（与表单校验一致）。 */
export const MILESTONE_NAME_MAX_LENGTH = 50;

/** 里程碑描述长度上限（与表单校验一致）。 */
export const MILESTONE_DESCRIPTION_MAX_LENGTH = 200;

/** 项目状态配色（映射现有 token，2026-11-21 设计裁定：不加新 token）。 */
import type { ProjectStatus } from "@open-doing/types";

export const PROJECT_STATUS_COLORS: Record<ProjectStatus, string> = {
  backlog: "var(--color-todo)",
  planned: "var(--color-info)",
  in_progress: "var(--color-primary)",
  completed: "var(--color-success)",
  canceled: "var(--color-text-muted)",
};

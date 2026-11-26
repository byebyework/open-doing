"use client";

import type { Tag } from "@open-doing/types";
import { useTranslations } from "next-intl";

import { ProjectCreateDialog } from "@/features/projects/components/ProjectCreateDialog";

/**
 * 「我的任务」页头部的新建个人项目入口（P-5 / D-1）。
 *
 * 设计文档 9.4 要求个人项目创建入口同时出现在个人空间侧栏与「我的任务」
 * 页头部；v1.1 M2 统一空间导航（`SpaceNavMenu`）不再提供侧栏项目列表，
 * 页头入口成为唯一入口，按钮文案保留「个人」以区分团队项目入口。
 * 成功后 `router.refresh()`（ProjectCreateDialog 内部处理）同时刷新
 * 列表数据与侧栏项目分组。
 *
 * 标签池由入口页 RSC 注入（type=project）；不设默认值——隐式空池会把
 * 已有标签伪装成「还没有标签」。
 */
export function NewPersonalProjectButton({
  projectTagPool,
}: {
  projectTagPool: Tag[];
}) {
  const t = useTranslations("personal");

  return (
    <ProjectCreateDialog
      space={{ kind: "personal" }}
      projectTagPool={projectTagPool}
      triggerLabel={t("newProjectButton")}
      testIdPrefix="personal-project"
      triggerTestId="new-personal-project-button"
    />
  );
}

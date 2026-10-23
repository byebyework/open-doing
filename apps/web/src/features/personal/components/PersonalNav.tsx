import { NavSection } from "@/components/layout/NavSection";
import { getCurrentUser } from "@/features/auth/session";
import { listPersonalProjects } from "@/features/personal/projects/service";

import { PersonalNavMenu } from "./PersonalNavMenu";

/**
 * 个人空间导航（P-5：我的任务 + 个人项目列表 + 新建项目入口）。
 *
 * 服务端读取当前用户与其个人项目，再把展示数据交给 `PersonalNavMenu`
 * （`"use client"`，负责 `usePathname` 高亮与新建弹窗）。
 * 未登录时返回 null，避免脱离 dashboard 布局单独渲染时报错。
 * `(dashboard)/layout.tsx` 只 import 本文件，P-5 不得修改布局。
 */
export async function PersonalNav() {
  const user = await getCurrentUser();
  if (!user) return null;

  const projects = await listPersonalProjects(user.id);

  return (
    <NavSection title="个人空间">
      <PersonalNavMenu
        projects={projects.map(({ slug, name }) => ({ slug, name }))}
      />
    </NavSection>
  );
}

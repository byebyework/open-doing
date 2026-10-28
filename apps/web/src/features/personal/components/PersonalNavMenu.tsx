"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import {
  personalProjectHref,
  spaceDashboardHref,
} from "@/lib/routes";

import { PersonalProjectFormModal } from "../projects/components/PersonalProjectFormModal";

/** 侧栏项目项所需的最小字段（服务端只传展示与跳转所需数据）。 */
export interface PersonalNavProject {
  slug: string;
  name: string;
}

/** `PersonalNavMenu` 入参。 */
export interface PersonalNavMenuProps {
  /** 当前用户的个人项目（按创建时间升序）。 */
  projects: PersonalNavProject[];
}

/** 导航项基础样式：与原型 `.nav-item` 对齐（8px 12px、8px 圆角、13.5px）。 */
const NAV_ITEM_BASE =
  "flex items-center gap-[10px] rounded-lg px-3 py-2 text-[13.5px] font-medium no-underline transition-colors";

/** 未选中态：次要文字色，hover 用浅灰表面。 */
const NAV_ITEM_IDLE =
  "text-[#3c4043] hover:bg-[#f4f5f7] hover:text-[#0e1318]";

/** 当前路由态：品牌紫文字 + 8% 紫底（原型 `.nav-item.active`）。 */
const NAV_ITEM_ACTIVE =
  "bg-[rgba(125,42,232,0.08)] font-semibold text-[#7d2ae8]";

/** 图标样式：17px、跟随文字色、原型 0.85 透明度。 */
const ICON_CLASS = "h-[17px] w-[17px] shrink-0 opacity-[0.85]";

/** 「我的任务」图标（原型勾选框）。 */
function MyTasksIcon() {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

/** 个人项目图标（原型文件夹）。 */
function FolderIcon() {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

/**
 * 个人空间导航菜单（P-5）。
 *
 * 服务端数据由 `PersonalNav` 取好后经 props 传入；本组件只负责：
 * - 「我的任务」入口 → 个人空间首页；
 * - 「个人项目」分组标题行尾的「＋」新建入口 → `PersonalProjectFormModal`；
 * - 每个项目一条子项 → 个人项目页；
 * - 用 `usePathname` 精确匹配当前路由做高亮。
 */
export function PersonalNavMenu({ projects }: PersonalNavMenuProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <Link
        href={spaceDashboardHref("personal")}
        aria-current={pathname === "/my" ? "page" : undefined}
        className={`${NAV_ITEM_BASE} ${
          pathname === "/my" ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE
        }`}
      >
        <MyTasksIcon />
        我的任务
      </Link>

      {/* 分组标题行：「个人项目」+ 行尾新建入口（V1_TASKS P-5 要求） */}
      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9aa0a6]">
          个人项目
        </span>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          aria-label="新建项目"
          title="新建项目"
          className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md text-[15px] font-semibold leading-none text-[#7d2ae8] transition-colors hover:bg-[rgba(125,42,232,0.08)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#7d2ae8]"
        >
          ＋
        </button>
      </div>

      {projects.map((project) => {
        const href = personalProjectHref(project.slug);
        const active = pathname === href;

        return (
          <Link
            key={project.slug}
            href={href}
            title={project.name}
            aria-current={active ? "page" : undefined}
            className={`${NAV_ITEM_BASE} min-w-0 py-2 pl-[34px] pr-3 text-[13px] ${
              active ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE
            }`}
          >
            <FolderIcon />
            <span className="min-w-0 truncate">{project.name}</span>
          </Link>
        );
      })}

      <PersonalProjectFormModal
        open={createOpen}
        mode="create"
        onSuccess={() => {
          setCreateOpen(false);
          // 刷新 RSC，让服务端读取的项目列表即时出现在侧栏（无需手动刷新页面）。
          router.refresh();
        }}
        onCancel={() => setCreateOpen(false)}
      />
    </>
  );
}

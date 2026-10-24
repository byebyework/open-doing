/**
 * 开发库示例数据（对照 docs/prototypes 静态原型）。
 *
 * 幂等策略：**守卫式跳过**。
 * - 写入前先检查种子用户「林夏」/ UID `doing_x7k2m9` 是否已存在；
 * - 已存在时打印「已初始化」并直接退出，不写入、不覆盖任何数据；
 * - 全部写入在同一个事务中完成，任一步失败都会回滚，避免留下半套数据。
 * 需要重建示例数据时，先清空开发库（例如 `docker compose down -v`，会同时
 * 清空测试库与 e2e 库，慎用），再重新执行 `db:seed`。
 *
 * 日期映射规则（任务截止日期以「今天」为锚）：
 * 原型基准日为 2026-10-21。原型中的日期 D 与基准日的天差
 * `offset = D - 2026-10-21`，落库截止日期 = 今天 + offset 天。
 * 例如原型「明天 10-22」→ 今天 + 1 天；原型「10-19 已逾期」→ 今天 - 2 天。
 * 这样无论在哪一天执行 seed，「今天/明天/逾期」的相对状态都与原型一致。
 *
 * 说明：
 * - 密码统一为 `seed-password`，哈希参数与注册流程一致（@node-rs/argon2 默认参数，Argon2id）。
 * - 角色映射与原型一致：周牧为团队所有者（owner），林夏为管理员（admin），
 *   其余成员为 member。owner 仅用于转让/解散等重要操作，管理员可重命名、
 *   邀请、移除成员和管理项目。
 * - 仅读取 `DATABASE_URL`（开发库），绝不触碰测试库 / e2e 库。
 */
import type { TaskStatus } from "@open-doing/types";
import { hash } from "@node-rs/argon2";
import { eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import { todayInShanghai } from "../../lib/today";
import * as schema from "./schema";
import {
  comments,
  projects,
  subtasks,
  tasks,
  teamMemberships,
  teams,
  users,
} from "./schema";

/** 迁移目录：apps/web/drizzle（相对本文件定位，不依赖执行 cwd）。 */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../drizzle", import.meta.url));

/** 所有种子账号统一密码（仅用于本地开发，切勿用于生产）。 */
const SEED_PASSWORD = "seed-password";

interface SeedUser {
  username: string;
  uid: string;
  role: "owner" | "admin" | "member";
}

/** 5 位成员，UID 与角色对照 docs/prototypes/team-settings.html。 */
const SEED_USERS: readonly SeedUser[] = [
  { username: "林夏", uid: "doing_x7k2m9", role: "admin" },
  { username: "周牧", uid: "doing_8f3qk2", role: "owner" },
  { username: "陈默", uid: "doing_2vbd81", role: "member" },
  { username: "苏晓", uid: "doing_5nqc04", role: "member" },
  { username: "高远", uid: "doing_6wtp77", role: "member" },
];

type SeedUsername = (typeof SEED_USERS)[number]["username"];

type ProjectKey = "website" | "mobile" | "growth" | "learning" | "life";

interface SeedProject {
  key: ProjectKey;
  name: string;
  slug: string;
  description: string;
}

/** 团队「增长突击队」下的 3 个项目。 */
const TEAM_PROJECTS: readonly SeedProject[] = [
  {
    key: "website",
    name: "官网改版",
    slug: "website-redesign",
    description: "品牌与首页体验升级，覆盖视觉、性能与内容迁移。",
  },
  {
    key: "mobile",
    name: "移动端 2.0",
    slug: "mobile-2-0",
    description: "移动端稳定性与交互体验升级。",
  },
  {
    key: "growth",
    name: "Q4 用户增长活动",
    slug: "q4-growth",
    description: "Q4 拉新与转化活动，含落地页与转化漏斗看板。",
  },
];

/** 林夏的 2 个个人项目（仅本人可见）。 */
const PERSONAL_PROJECTS: readonly SeedProject[] = [
  {
    key: "learning",
    name: "学习成长",
    slug: "learning-growth",
    description: "持续学习与个人知识管理。",
  },
  {
    key: "life",
    name: "生活琐事",
    slug: "life-notes",
    description: "需要定期处理的生活事项。",
  },
];

const TEAM_PROJECT_KEYS = new Set<ProjectKey>(TEAM_PROJECTS.map((project) => project.key));

interface SeedSubtask {
  title: string;
  completed: boolean;
}

interface SeedComment {
  author: SeedUsername;
  content: string;
  /** 相对今天的天数偏移（原型 10-20 → -1，即昨天）。 */
  offset: number;
  hour: number;
  minute: number;
}

interface SeedTask {
  project: ProjectKey | null;
  title: string;
  description?: string;
  status: TaskStatus;
  assignee: SeedUsername | null;
  /** 原型日期相对基准日 2026-10-21 的天数偏移；null 表示无截止日期。 */
  dueOffset: number | null;
  /** 创建时间相对今天的天数偏移；缺省按截止日期前 7 天推算。 */
  createdOffset?: number;
  subtasks?: readonly SeedSubtask[];
  comments?: readonly SeedComment[];
}

/**
 * 全部任务对照 docs/prototypes 的 project-list / project-board / my-tasks /
 * personal-project / task-detail / team-overview 提取。
 *
 * 「Q4 活动预热推文排期」为补充数据：原型没有基准日当天到期的任务，
 * 为覆盖「今天临期」状态而新增，截止日期偏移记为 0（即今天）。
 */
const SEED_TASKS: readonly SeedTask[] = [
  // ---- 团队项目：官网改版 ----
  {
    project: "website",
    title: "完成首页新版视觉稿",
    description:
      "基于新版品牌视觉对齐首页设计稿，输出桌面端与移动端两套高保真视觉稿，并完成切图与标注，作为前端改版实现的直接依据。验收标准：视觉稿通过设计评审，并同步到 Figma 规范页。",
    status: "in_progress",
    assignee: "林夏",
    dueOffset: 1,
    createdOffset: -10,
    subtasks: [
      { title: "收集竞品首页截图", completed: true },
      { title: "输出信息架构草图", completed: true },
      { title: "与产品确认首屏信息层级", completed: true },
      { title: "完成桌面端视觉稿", completed: false },
      { title: "输出切图与标注", completed: false },
    ],
    comments: [
      {
        author: "周牧",
        content: "首屏版本明天中午前能过一遍吗？运营下周三要用。",
        offset: -1,
        hour: 18,
        minute: 2,
      },
      {
        author: "苏晓",
        content: "移动端导航建议沿用上次评审的底部 Tab 方案，和组件库迁移那项保持一致。",
        offset: -1,
        hour: 19,
        minute: 21,
      },
      {
        author: "林夏",
        content: "收到，桌面版今晚出第二版，明早先同步视觉稿链接。",
        offset: -1,
        hour: 17,
        minute: 42,
      },
    ],
  },
  {
    project: "website",
    title: "首页 Lighthouse 性能达标",
    status: "in_progress",
    assignee: "陈默",
    dueOffset: 2,
    subtasks: [
      { title: "建立性能基线", completed: true },
      { title: "图片懒加载与压缩", completed: true },
      { title: "字体子集化", completed: true },
      { title: "关键 CSS 内联", completed: true },
      { title: "第三方脚本延迟加载", completed: false },
      { title: "LCP 回归验证", completed: false },
    ],
  },
  {
    project: "website",
    title: "组件库 Token 迁移",
    status: "in_progress",
    assignee: "高远",
    dueOffset: 3,
    subtasks: [
      { title: "盘点旧变量", completed: true },
      { title: "映射颜色 Token", completed: true },
      { title: "迁移间距 Token", completed: false },
      { title: "迁移圆角与阴影", completed: false },
      { title: "视觉回归检查", completed: false },
    ],
  },
  {
    project: "website",
    title: "定价页响应式适配",
    status: "in_progress",
    assignee: "陈默",
    dueOffset: 6,
    subtasks: [
      { title: "断点方案确认", completed: true },
      { title: "平板布局适配", completed: false },
      { title: "移动端验收", completed: false },
    ],
  },
  {
    project: "website",
    title: "新版字体授权采购",
    status: "in_progress",
    assignee: "周牧",
    dueOffset: 9,
    subtasks: [
      { title: "供应商询价", completed: false },
      { title: "法务审核授权条款", completed: false },
    ],
  },
  {
    project: "website",
    title: "Hero 区文案终审",
    status: "todo",
    assignee: "林夏",
    dueOffset: 5,
  },
  {
    project: "website",
    title: "旧版帮助中心内容迁移",
    status: "todo",
    // 原型明确标注「未指派」：成员退出后保留任务，等待管理员重新分配。
    assignee: null,
    dueOffset: 7,
  },
  {
    project: "website",
    title: "404/500 空状态插画",
    status: "todo",
    assignee: "苏晓",
    dueOffset: null,
  },
  {
    project: "website",
    title: "导航栏信息架构梳理",
    status: "done",
    assignee: "苏晓",
    dueOffset: -6,
  },
  {
    project: "website",
    title: "SEO 落地页 Meta 信息梳理",
    status: "todo",
    assignee: "陈默",
    dueOffset: 8,
  },
  {
    project: "website",
    title: "表单校验错误状态设计",
    status: "done",
    assignee: "高远",
    dueOffset: -5,
  },
  {
    project: "website",
    title: "Footer 链接合规检查",
    status: "done",
    assignee: "周牧",
    dueOffset: -7,
  },

  // ---- 团队项目：移动端 2.0 ----
  {
    project: "mobile",
    title: "推送权限引导弹窗交互",
    status: "in_progress",
    assignee: "林夏",
    dueOffset: -2,
    subtasks: [
      { title: "交互稿评审", completed: true },
      { title: "权限文案确定", completed: true },
      { title: "引导弹窗开发", completed: false },
      { title: "埋点上报", completed: false },
    ],
  },
  {
    project: "mobile",
    title: "安卓端崩溃率治理",
    status: "in_progress",
    assignee: "高远",
    dueOffset: -5,
  },

  // ---- 团队项目：Q4 用户增长活动 ----
  {
    project: "growth",
    title: "活动落地页埋点方案",
    status: "done",
    assignee: "林夏",
    dueOffset: -4,
  },
  {
    project: "growth",
    title: "注册转化漏斗看板",
    status: "in_progress",
    assignee: "陈默",
    dueOffset: 1,
  },
  {
    project: "growth",
    title: "Q4 活动预热推文排期",
    status: "in_progress",
    assignee: "林夏",
    dueOffset: 0,
  },

  // ---- 个人项目：学习成长 ----
  {
    project: "learning",
    title: "读书笔记：《项目管理实战》第 4–6 章",
    status: "in_progress",
    assignee: "林夏",
    dueOffset: null,
    subtasks: [
      { title: "第 4 章", completed: true },
      { title: "第 5 章", completed: true },
      { title: "第 6 章", completed: true },
      { title: "整理读书卡片", completed: false },
      { title: "输出实践清单", completed: false },
    ],
  },
  {
    project: "learning",
    title: "完成 TypeScript 体操 10 题",
    status: "in_progress",
    assignee: "林夏",
    dueOffset: 1,
    subtasks: [
      { title: "第 1 题", completed: true },
      { title: "第 2 题", completed: true },
      { title: "第 3 题", completed: true },
      { title: "第 4 题", completed: true },
      { title: "第 5 题", completed: false },
      { title: "第 6 题", completed: false },
      { title: "第 7 题", completed: false },
      { title: "第 8 题", completed: false },
      { title: "第 9 题", completed: false },
      { title: "第 10 题", completed: false },
    ],
  },
  {
    project: "learning",
    title: "输出季度复盘文档",
    status: "in_progress",
    assignee: "林夏",
    dueOffset: 4,
  },
  {
    project: "learning",
    title: "看完 Drizzle ORM 迁移指南并做笔记",
    status: "todo",
    assignee: "林夏",
    dueOffset: 7,
  },
  {
    project: "learning",
    title: "每周 LeetCode 5 题",
    status: "in_progress",
    assignee: "林夏",
    dueOffset: 5,
    subtasks: [
      { title: "第 1 题", completed: true },
      { title: "第 2 题", completed: true },
      { title: "第 3 题", completed: false },
      { title: "第 4 题", completed: false },
      { title: "第 5 题", completed: false },
    ],
  },
  {
    project: "learning",
    title: "整理个人知识库标签体系",
    status: "todo",
    assignee: "林夏",
    dueOffset: null,
  },
  {
    project: "learning",
    title: "学完 Figma 自动布局课程",
    status: "done",
    assignee: "林夏",
    dueOffset: -6,
  },
  {
    project: "learning",
    title: "整理上半年学习清单归档",
    status: "done",
    assignee: "林夏",
    dueOffset: -9,
  },
  {
    project: "learning",
    title: "制定 Q4 学习计划",
    status: "todo",
    assignee: "林夏",
    dueOffset: 10,
  },

  // ---- 个人项目：生活琐事 ----
  {
    project: "life",
    title: "预约年度体检",
    status: "todo",
    assignee: "林夏",
    dueOffset: 4,
  },

  // ---- 零散个人任务（不归属项目） ----
  {
    project: null,
    title: "整理本周工作周报",
    status: "in_progress",
    assignee: "林夏",
    dueOffset: 1,
    subtasks: [
      { title: "汇总本周完成事项", completed: true },
      { title: "整理下周计划", completed: true },
      { title: "补充风险与求助", completed: false },
    ],
  },
  {
    project: null,
    title: "提交差旅报销单",
    status: "done",
    assignee: "林夏",
    dueOffset: -3,
  },
];

/** 将 `YYYY-MM-DD` 按 UTC 加减天数，避免宿主时区影响日期结果。 */
function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** 原型日期 → 以今天为锚的日期字符串（offset = D - 2026-10-21）。 */
function dateFromOffset(today: string, offset: number): string {
  return addDays(today, offset);
}

/** 以上海时区构造当天某时刻的时间戳（用于 createdAt / updatedAt）。 */
function timestampFromOffset(today: string, offset: number, hour = 10, minute = 0): Date {
  const date = dateFromOffset(today, offset);
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${date}T${hh}:${mm}:00+08:00`);
}

function requireId(map: Map<string, string>, key: string): string {
  const id = map.get(key);
  if (!id) throw new Error(`seed 内部错误：找不到 ${key} 的数据库 ID`);
  return id;
}

/** 为个人任务推导 spaceType；无项目的零散任务按个人空间处理。 */
function resolveSpaceType(project: ProjectKey | null): "personal" | "team" {
  if (project === null) return "personal";
  return TEAM_PROJECT_KEYS.has(project) ? "team" : "personal";
}

async function seed(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "缺少 DATABASE_URL；请先加载环境变量，例如：set -a; source apps/web/.env.local; set +a",
    );
  }

  // 忽略迁移重放时 PostgreSQL 的 "already exists, skipping" 通知，保持输出简洁。
  const sqlClient = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const db = drizzle(sqlClient, { schema });

  try {
    // 与 testing.ts 相同的迁移重放方式：空库也能直接 seed。
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.username, "林夏"), eq(users.uid, "doing_x7k2m9")))
      .limit(1);

    if (existing.length > 0) {
      console.log("已初始化：检测到种子用户 林夏（doing_x7k2m9），跳过 seed（未做任何修改）。");
      return;
    }

    const today = todayInShanghai();
    // 所有账号密码相同：只计算一次哈希即可（参数与注册流程一致）。
    const passwordHash = await hash(SEED_PASSWORD);

    const summary = await db.transaction(async (tx) => {
      const userRows = await tx
        .insert(users)
        .values(
          SEED_USERS.map((user) => ({
            uid: user.uid,
            username: user.username,
            passwordHash,
            createdAt: timestampFromOffset(today, -30, 9),
          })),
        )
        .returning({ id: users.id, username: users.username });
      const userIdByName = new Map(
        userRows.map((row) => [row.username, row.id] as const),
      );

      const [team] = await tx
        .insert(teams)
        .values({
          name: "增长突击队",
          slug: "growth-squad",
          ownerId: requireId(userIdByName, "周牧"),
          createdAt: timestampFromOffset(today, -21, 10),
        })
        .returning({ id: teams.id });
      if (!team) throw new Error("seed 内部错误：团队创建失败");

      await tx.insert(teamMemberships).values(
        SEED_USERS.map((user) => ({
          teamId: team.id,
          userId: requireId(userIdByName, user.username),
          role: user.role,
          joinedAt: timestampFromOffset(today, -21, 10),
        })),
      );

      const teamProjectRows = await tx
        .insert(projects)
        .values(
          TEAM_PROJECTS.map((project) => ({
            teamId: team.id,
            ownerId: null,
            name: project.name,
            slug: project.slug,
            description: project.description,
            createdAt: timestampFromOffset(today, -20, 10),
          })),
        )
        .returning({ id: projects.id, slug: projects.slug });

      const personalProjectRows = await tx
        .insert(projects)
        .values(
          PERSONAL_PROJECTS.map((project) => ({
            teamId: null,
            ownerId: requireId(userIdByName, "林夏"),
            name: project.name,
            slug: project.slug,
            description: project.description,
            createdAt: timestampFromOffset(today, -18, 10),
          })),
        )
        .returning({ id: projects.id, slug: projects.slug });

      const projectIdByKey = new Map<string, string>();
      for (const project of TEAM_PROJECTS) {
        const row = teamProjectRows.find((candidate) => candidate.slug === project.slug);
        if (!row) throw new Error(`seed 内部错误：团队项目 ${project.slug} 创建失败`);
        projectIdByKey.set(project.key, row.id);
      }
      for (const project of PERSONAL_PROJECTS) {
        const row = personalProjectRows.find((candidate) => candidate.slug === project.slug);
        if (!row) throw new Error(`seed 内部错误：个人项目 ${project.slug} 创建失败`);
        projectIdByKey.set(project.key, row.id);
      }

      let taskCount = 0;
      let subtaskCount = 0;
      let commentCount = 0;

      for (const seedTask of SEED_TASKS) {
        const createdAt = timestampFromOffset(
          today,
          seedTask.createdOffset ?? Math.min(seedTask.dueOffset ?? 0, 0) - 7,
          10,
        );
        const updatedAt =
          seedTask.status === "done"
            ? timestampFromOffset(today, seedTask.dueOffset ?? -1, 18)
            : createdAt;

        const [task] = await tx
          .insert(tasks)
          .values({
            projectId: seedTask.project
              ? requireId(projectIdByKey, seedTask.project)
              : null,
            spaceType: resolveSpaceType(seedTask.project),
            title: seedTask.title,
            description: seedTask.description ?? null,
            status: seedTask.status,
            assigneeId: seedTask.assignee
              ? requireId(userIdByName, seedTask.assignee)
              : null,
            dueDate:
              seedTask.dueOffset === null
                ? null
                : dateFromOffset(today, seedTask.dueOffset),
            createdById: requireId(
              userIdByName,
              seedTask.assignee ?? "林夏",
            ),
            createdAt,
            updatedAt,
          })
          .returning({ id: tasks.id });
        if (!task) throw new Error(`seed 内部错误：任务「${seedTask.title}」创建失败`);
        taskCount += 1;

        if (seedTask.subtasks?.length) {
          await tx.insert(subtasks).values(
            seedTask.subtasks.map((subtask) => ({
              taskId: task.id,
              title: subtask.title,
              completed: subtask.completed,
              createdAt,
              completedAt: subtask.completed
                ? timestampFromOffset(today, -2, 12)
                : null,
            })),
          );
          subtaskCount += seedTask.subtasks.length;
        }

        if (seedTask.comments?.length) {
          await tx.insert(comments).values(
            seedTask.comments.map((comment) => ({
              taskId: task.id,
              authorId: requireId(userIdByName, comment.author),
              content: comment.content,
              createdAt: timestampFromOffset(
                today,
                comment.offset,
                comment.hour,
                comment.minute,
              ),
            })),
          );
          commentCount += seedTask.comments.length;
        }
      }

      return {
        users: userRows.length,
        projects: teamProjectRows.length + personalProjectRows.length,
        tasks: taskCount,
        subtasks: subtaskCount,
        comments: commentCount,
      };
    });

    console.log(
      `seed 完成：${summary.users} 位用户、1 个团队、${summary.projects} 个项目、` +
        `${summary.tasks} 个任务、${summary.subtasks} 个子任务、${summary.comments} 条评论。`,
    );
    console.log("登录账号：林夏（doing_x7k2m9），密码：seed-password。");
  } finally {
    await sqlClient.end({ timeout: 5 });
  }
}

seed().catch((error: unknown) => {
  console.error("seed 失败：", error);
  process.exitCode = 1;
});

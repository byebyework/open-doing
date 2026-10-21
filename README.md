# Open Doing

项目任务进度管理系统。解决三个问题：个人任务理不清、团队进度不同步、上级看不到工作情况。

## Monorepo 结构

使用 pnpm workspaces 管理：

```
apps/
└── web/                    # Next.js 应用（App Router）
    └── src/
        ├── app/            # 路由
        │   ├── (auth)/     # 登录、注册
        │   ├── (dashboard)/
        │   │   ├── my/     # 个人空间：我的任务
        │   │   └── teams/  # 团队 → 项目 → 任务
        │   └── api/
        ├── features/       # 按领域组织：auth / teams / projects / tasks
        ├── components/     # ui、layout
        ├── hooks/
        ├── lib/
        └── server/         # 数据库、鉴权等服务端设施（待接入）

packages/
└── types/                  # @open-doing/types 共享领域模型
```

## 技术栈

- Next.js 16（App Router, Turbopack）+ React 19 + TypeScript
- Tailwind CSS 4
- pnpm workspaces

## 快速开始

```bash
pnpm install
pnpm dev          # 启动 web 应用，等价于 pnpm --filter @open-doing/web dev
```

打开 http://localhost:3000。

其他常用命令（在根目录执行）：

```bash
pnpm build        # 构建 web 应用
pnpm lint         # 对所有包执行 lint
pnpm typecheck    # 对所有包执行类型检查
```

新增内部包：在 `packages/` 下创建目录，以 `@open-doing/*` 命名，应用中通过 `"workspace:*"` 引用。

## 领域模型要点

- 每个用户默认拥有**个人空间**；可创建**团队空间**并通过邀请加入成员。
- 团队 → 项目 → 任务；个人任务不归属项目。
- 任务包含：标题、描述、状态、责任人、截止日期、子任务、评论。
- 任务状态（未开始 / 进行中 / 已完成）**手动切换**。
- 任务进度：有子任务时按 `已完成子任务 / 子任务总数` 计算；无子任务时按状态映射（0 / 0.5 / 1）。定义见 `packages/types/src/index.ts`。

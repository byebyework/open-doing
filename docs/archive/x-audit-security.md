# Track X 安全审计（2026-10-25）

X-5 走查结论。逐服务函数核对鉴权入口与设计文档 §5 角色矩阵，并对 cookie、argon2、
cron 密钥、UID 不可枚举、SQL 注入面、XSS 做基础设施核查。每条给出 `file:line`
证据与判定；不使用「已检查」一类无证据条目。

## 1. 方法与证据

- 代码：本仓库 worktree，分支 `asher/m33`，基线 `b59147e`。
- 范围：`apps/web/src/features/**/service.ts`、`apps/web/src/features/**/actions.ts`、
  `apps/web/src/app/api/**`，以及它们直接依赖的会话 / 权限 / 通知查询模块。
- 矩阵：设计文档 §5（`docs/2026-10-21-open-doing-v1-design.md:83-108`）与 §6 生命周期
  （`:110-117`）。团队治理判定唯一实现为 `apps/web/src/features/teams/permissions.ts:51`，
  任务粒度判定为 `apps/web/src/features/tasks/permissions.ts:37-82`。
- 「有测试」的判定方式：实际读取测试文件并定位到断言该行为的 `it(...)` 行；不按测试名猜测。
  测试路径以下均相对 `apps/web/src/`。基线：`TEST_DATABASE_URL=... pnpm test` 33 个文件 /
  297 条全绿。
- 「无测试-低风险」= 该函数没有直接自动化断言，但其安全性质由更底层的已测原语
  （`assertCan` / `assertCanEditTask` / `requireUser` 等）或页面调用方的显式守卫保证，
  本次未发现可被利用的缺陷。
- 审计驱动：本次未发现可实证的权限绕过 / SQL 注入 / XSS / 密钥绕过，因此没有代码修复
  commit；唯一交付为本文件（`docs(x): security audit`）。

## 2. 鉴权入口总览

| 入口 | 守卫 | 证据 |
|---|---|---|
| `(dashboard)` 全部页面（RSC / Server Action 所在路由） | 未登录重定向 `/login` | `apps/web/src/app/(dashboard)/layout.tsx:19`；`features/auth/session.ts:113` |
| 团队页面（概览 / 设置 / 项目 / 任务） | 团队不存在或非成员一律 404 | `app/(dashboard)/teams/[teamSlug]/page.tsx:64-66`；`settings/page.tsx:36-38`；`projects/[projectSlug]/page.tsx:43-50`；`.../tasks/[taskId]/page.tsx:37-44` |
| 个人页面（我的任务 / 个人项目 / 个人任务） | 全部查询以会话 `user.id` 归属过滤 | `app/(dashboard)/my/page.tsx:51`；`my/projects/[projectSlug]/page.tsx:40-47`；`my/tasks/[taskId]/page.tsx:24-27` |
| Server Actions（团队 / 项目 / 任务 / 通知） | `getCurrentUser()`，未登录返回「请先登录」 | 见 §3-§9 各 actions 表 |
| Server Actions（个人空间） | `requireUser()`（保留 `redirect()` 冒泡） | `features/personal/tasks/actions.ts:51` 等；见 §7 |
| `GET /api/notifications` | `getSessionUserId()`，未登录 401 | `app/api/notifications/route.ts:37-41` |
| `POST /api/cron/due-scan` | `CRON_SECRET` 完全匹配，否则 401 | `app/api/cron/due-scan/route.ts:17-20`；`auth.ts:14-25` |

全仓 `app/` 页面与 Server Action 的非测试代码中没有绕过 service 直连 `server/db` 的 import
（grep `server/db` 命中 `features/**/service.ts`、权限模块
`features/teams/permissions.ts:4-5`、查询模块 `features/notifications/queries.ts:4-5` 与
`features/notifications/due-scan.ts:4-5`，以及 `server/db/*` 自身；`app/api/**` 路由与
`app/**` 页面组件均无直接 DB import）。

## 3. auth 域

### 3.1 `features/auth/service.ts`

| 函数（file:line） | 矩阵分支 | 结论 |
|---|---|---|
| `registerUser` `features/auth/service.ts:126` | 公开注册；无角色 | 有测试 `features/auth/service.test.ts:45`（argon2id 落库）、`:64`（用户名重复）、`:79`（UID 碰撞重试）、`:95`（长度校验） |
| `login` `features/auth/service.ts:174` | 公开登录；不区分用户不存在 / 密码错误 | 有测试 `features/auth/service.test.ts:109`（成功）、`:118`（同一错误文案，防用户名枚举） |
| `logout` `features/auth/service.ts:197` | 任意已登录用户 | 无测试-低风险（仅调用 `clearSession`；无 e2e 登出用例，清除 cookie 逻辑见 `session.ts:96-102`） |

### 3.2 `features/auth/session.ts`（会话基础设施）

| 函数（file:line） | 结论 |
|---|---|
| `getSessionSecret` `features/auth/session.ts:34` | 无测试-低风险（生产缺失即抛错的 `:38-40` 分支未单测；开发回退密钥仅非生产） |
| `signSessionToken` `features/auth/session.ts:46` | 有测试 `features/auth/session.test.ts:17`、`:23`（HS256 + 30 天 exp） |
| `verifySessionToken` `features/auth/session.ts:62` | 有测试 `features/auth/session.test.ts:17`、`:31`（异密钥伪造失败）、`:37`（篡改失败）；`algorithms: ["HS256"]` 固定，防算法混淆 |
| `createSession` `features/auth/session.ts:76` | 无测试-低风险（`cookies().set` 未 mock；写入属性常量已单测，见 §11.1） |
| `getSessionUserId` `features/auth/session.ts:83` | 无测试-低风险（由 `app/api/notifications/route.test.ts:49` mock 调用，未测实现） |
| `clearSession` `features/auth/session.ts:96` | 无测试-低风险（同上，`maxAge: 0` 逻辑简单） |
| `getCurrentUser` `features/auth/session.ts:105` | 无测试-低风险（所有 actions 测试 mock 此函数；实现为「验签 → 按 id 查库」） |
| `requireUser` `features/auth/session.ts:113` | 有测试（e2e，采样）`e2e/responsive.spec.ts:248-254`：未登录 `/invites` 重定向 `/login` |

### 3.3 `features/auth/actions.ts`

| 函数（file:line） | 鉴权入口 | 结论 |
|---|---|---|
| `registerAction` `features/auth/actions.ts:33` | 公开 | 无测试-低风险（service 已测；action 仅做错误映射 + `createSession`） |
| `loginAction` `features/auth/actions.ts:43` | 公开 | 无测试-低风险（同上） |
| `logoutAction` `features/auth/actions.ts:53` | 无需登录也可安全执行 | 无测试-低风险（同上） |

## 4. users 域

`features/users/service.ts` 为只读 / 凭据查询，无角色矩阵分支；调用方均为已鉴权上下文。

| 函数（file:line） | 结论 |
|---|---|
| `toUser` `features/users/service.ts:16` | 有测试（间接）`features/auth/service.test.ts:45`、`:142` |
| `getUserById` `features/users/service.ts:26` | 有测试 `features/auth/service.test.ts:142`（命中 / 未命中） |
| `findByUid` `features/users/service.ts:35` | 有测试 `features/auth/service.test.ts:142-148`（精确匹配，未命中 null） |
| `getCredentialsByUsername` `features/users/service.ts:50` | 有测试（间接）`features/auth/service.test.ts:109`、`:118` |
| `usernameExists` `features/users/service.ts:65` | 有测试（间接）`features/auth/service.test.ts:64`、`:95` |

## 5. teams 域

### 5.1 `features/teams/permissions.ts`（矩阵唯一实现）

| 函数（file:line） | 矩阵分支 | 结论 |
|---|---|---|
| `can` `features/teams/permissions.ts:51` | 8 个 `TeamAction` × owner/admin/member/null 全表 | 有测试 `features/teams/permissions.test.ts:11-46`（表驱动逐格断言） |
| `assertCan` `features/teams/permissions.ts:71` | 允许 / 拒绝两路 | 有测试 `features/teams/permissions.test.ts:48-60` |
| `toMembership` `features/teams/permissions.ts:78` | 无 | 有测试（间接）`features/teams/service.test.ts:122` |
| `getMembership` `features/teams/permissions.ts:93` | 成员 / 非成员 | 有测试 `features/teams/service.test.ts:122-129` |

### 5.2 `features/teams/service.ts`

| 函数（file:line） | 矩阵分支 | 结论 |
|---|---|---|
| `createTeam` `features/teams/service.ts:100` | 任意登录用户成为 owner | 有测试 `features/teams/service.test.ts:47`（自动 owner）、`:65`（名校验）、`:82`/`:92`（slug 冲突） |
| `getTeamBySlug` `features/teams/service.ts:142` | 只读；调用方负责成员校验 | 有测试 `features/teams/service.test.ts:114` |
| `listTeamsForUser` `features/teams/service.ts:151` | 按 userId 隔离 | 有测试 `features/teams/service.test.ts:102` |
| `renameTeam` `features/teams/service.ts:168` | owner/admin 可；member/非成员拒 | 有测试 `features/teams/service.test.ts:132`（owner 成功、member/非成员拒）、`:151`（名校验）；admin 成功仅由 `permissions.test.ts:24-46` 判定层覆盖，service 接线未单独断言（见 §10.1 评估） |
| `listMembers` `features/teams/service.ts:193` | 只读；函数内无鉴权 | 有测试 `features/teams/service.test.ts:160`（数据/排序）；调用方已在成员校验之后：`teams/[teamSlug]/page.tsx:64-66`、`settings/page.tsx:36-38`、`projects/[projectSlug]/page.tsx:46-55`、`.../tasks/[taskId]/page.tsx:40-55` |

### 5.3 `features/teams/members/service.ts`

| 函数（file:line） | 矩阵分支 | 结论 |
|---|---|---|
| `removeMember` `features/teams/members/service.ts:125` | owner/admin 可；member/非成员拒；owner 不可被移除 | 有测试 `features/teams/members/service.test.ts:169`（admin 移除 + 仅清本团队项目责任人）、`:200`（重复移除）、`:218`（admin 移除 owner 拒）、`:232`（member 拒）；owner 成功仅判定层覆盖 |
| `leaveTeam` `features/teams/members/service.ts:163` | admin/member 可；owner 拒；非成员拒 | 有测试 `features/teams/members/service.test.ts:246`（owner 拒 + 文案）、`:258`（member 成功，跨团队/个人任务不受影响）、`:274`（非成员拒）；admin 成功仅判定层覆盖 |
| `transferTeam` `features/teams/members/service.ts:198` | 仅 owner；受让人须为成员、不能是自己 | 有测试 `features/teams/members/service.test.ts:366`（owner 成功、恰一个 owner）、`:387`（admin/member 拒）、`:410`（非成员受让人）、`:425`（转让自己）、`:504`（解散后） |
| `dissolveTeam` `features/teams/members/service.ts:255` | 仅 owner | 有测试 `features/teams/members/service.test.ts:441`（admin/member 拒）、`:458`（owner 成功，七类级联清理）、`:504`（解散后再调） |

### 5.4 `features/teams/invites/service.ts`

| 函数（file:line） | 矩阵分支 | 结论 |
|---|---|---|
| `createInvite` `features/teams/invites/service.ts:66` | owner/admin 可；member/非成员拒 | 有测试 `features/teams/invites/service.test.ts:64`（owner 成功、admin 通过权限后被 pending 去重拦、member 拒）、`:80`（UID 无效统一文案）、`:92`（自己 / 已是成员）、`:104`（重复 pending + 唯一索引）、`:123`（邀请与通知同事务） |
| `rescindInvite` `features/teams/invites/service.ts:151` | owner/admin 可；member 拒 | 有测试 `features/teams/invites/service.test.ts:139`（owner 成功撤销 + 通知）、`:155`（非 pending / member 拒）；admin 成功仅判定层覆盖，service 接线未单独断言（见 §10.1 评估） |
| `respondToInvite` `features/teams/invites/service.ts:204` | 仅被邀请人本人；必须 pending | 有测试 `features/teams/invites/service.test.ts:189`（接受）、`:214`（邀请通知置已读）、`:233`（拒绝）、`:245`（已撤销 / 已响应 / 非本人）、`:270`（团队解散后无效） |
| `listPendingSentInvites` `features/teams/invites/service.ts:276` | 只读；函数内无鉴权 | 有测试 `features/teams/invites/service.test.ts:169`；唯一调用方 `settings/page.tsx:40,47` 已用 `can(..., "team:invite")` 守卫 |
| `listReceivedInvites` `features/teams/invites/service.ts:302` | 按 userId 隔离 | 有测试 `features/teams/invites/service.test.ts:282`；调用方 `invites/page.tsx:28-29`、`TeamsNav.tsx:24-27` 均以会话 userId 入参 |

### 5.5 `features/teams/actions.ts`

| 函数（file:line） | 鉴权入口 | 结论 |
|---|---|---|
| `createTeamAction` `features/teams/actions.ts:27` | `getCurrentUser` `:31` | 有测试 `features/teams/actions.test.ts:43`（未登录）、`:52`（成功）、`:67`（校验错误） |
| `renameTeamAction` `features/teams/actions.ts:44` | `getCurrentUser` `:49` | 有测试 `features/teams/actions.test.ts:81`（未登录）、`:90`（member 拒）、`:104`（成功） |

### 5.6 `features/teams/members/actions.ts`

| 函数（file:line） | 鉴权入口 | 结论 |
|---|---|---|
| `removeMemberAction` `features/teams/members/actions.ts:48` | `getCurrentUser` `:53` + 团队/成员解析 `:37-45` | 有测试 `features/teams/members/actions.test.ts:92`（未登录）、`:105`/`:114`（团队不存在 / 非成员统一文案）、`:126`（成功）、`:159`（权限错误） |
| `leaveTeamAction` `features/teams/members/actions.ts:78` | `getCurrentUser` `:80` | 有测试 `features/teams/members/actions.test.ts:146`（成功）、`:171`（owner 策略文案） |
| `transferTeamAction` `features/teams/members/actions.ts:100` | `getCurrentUser` `:105` | 有测试 `features/teams/members/actions.test.ts:197`（未登录）、`:232`（成功）、`:265`（权限）、`:282`（领域错误） |
| `dissolveTeamAction` `features/teams/members/actions.ts:130` | `getCurrentUser` `:134` | 有测试 `features/teams/members/actions.test.ts:210`（非成员统一文案）、`:252`（成功）、`:265`（权限） |

### 5.7 `features/teams/invites/actions.ts`

| 函数（file:line） | 鉴权入口 | 结论 |
|---|---|---|
| `createInviteAction` `features/teams/invites/actions.ts:33` | `getCurrentUser` `:37`，`actorId` 覆盖客户端值 `:42` | 有测试 `features/teams/invites/actions.test.ts:43`（未登录）、`:52`（member 拒）、`:66`（UID 错误）、`:80`（成功） |
| `rescindInviteAction` `features/teams/invites/actions.ts:50` | `getCurrentUser` `:54` | 有测试 `features/teams/invites/actions.test.ts:97` |
| `respondToInviteAction` `features/teams/invites/actions.ts:67` | `getCurrentUser` `:71` | 有测试 `features/teams/invites/actions.test.ts:116`、`:141`（失效邀请友好错误，不 500） |

## 6. projects 域

### 6.1 `features/projects/service.ts`（团队项目）

| 函数（file:line） | 矩阵分支 | 结论 |
|---|---|---|
| `listTeamProjects` `features/projects/service.ts:80` | 只读；函数内无鉴权 | 有测试 `features/projects/service.test.ts:258`；调用方 `teams/[teamSlug]/projects/[projectSlug]/page.tsx:46-55` 在成员校验后调用 |
| `listTeamProjectsForTeams` `features/projects/service.ts:98` | 只读；入参 teamIds 由调用方限定 | 有测试 `features/projects/service.test.ts:258`；唯一调用方 `TeamsNav.tsx:30-33` 传入 `listTeamsForUser` 的结果 |
| `getTeamProjectBySlug` `features/projects/service.ts:118` | 限定 teamId，跨团队返回 null | 有测试 `features/projects/service.test.ts:243`；调用方均在成员校验后 |
| `createTeamProject` `features/projects/service.ts:138` | owner/admin 可；member/非成员拒 | 有测试 `features/projects/service.test.ts:81`（owner）、`:99`（admin 可、member/非成员拒）、`:122`/`:144`（slug）、`:160`（校验） |
| `updateTeamProject` `features/projects/service.ts:184` | owner/admin 可 | 有测试 `features/projects/service.test.ts:175`（owner 改名 / 清空描述、member 拒）、`:273`（跨团队拒）；admin 成功仅判定层覆盖 |
| `deleteTeamProject` `features/projects/service.ts:232` | owner/admin 可 | 有测试 `features/projects/service.test.ts:199`（owner 删除级联、member 拒）、`:273`（跨团队拒）；admin 成功仅判定层覆盖 |

### 6.2 `features/projects/actions.ts`

| 函数（file:line） | 鉴权入口 | 结论 |
|---|---|---|
| `createTeamProjectAction` `features/projects/actions.ts:32` | `getCurrentUser` `:37`；`actorId` 覆盖客户端值 `:43` | 有测试 `features/projects/actions.test.ts:60`（未登录）、`:78`（权限）、`:105`（成功） |
| `updateTeamProjectAction` `features/projects/actions.ts:51` | `getCurrentUser` `:57` | 有测试 `features/projects/actions.test.ts:60`（未登录族）、`:87`（领域错误）、`:105`（成功） |
| `deleteTeamProjectAction` `features/projects/actions.ts:71` | `getCurrentUser` `:75` | 有测试 `features/projects/actions.test.ts:60`、`:96`（未知异常通用文案）、`:105` |

### 6.3 `features/personal/projects/service.ts`（个人项目，仅本人）

| 函数（file:line） | 矩阵分支 | 结论 |
|---|---|---|
| `listPersonalProjects` `features/personal/projects/service.ts:75` | 仅 ownerId 本人 | 有测试 `features/personal/projects/service.test.ts:195`（只返回本人）、`:86`（同名项目互不占用） |
| `getPersonalProjectBySlug` `features/personal/projects/service.ts:93` | 他人 / 不存在均 null | 有测试 `features/personal/projects/service.test.ts:97` |
| `createPersonalProject` `features/personal/projects/service.ts:114` | 任意登录用户，归属本人 | 有测试 `features/personal/projects/service.test.ts:48`、`:67`（slug -2）、`:182`（中文回落）、`:219`（校验） |
| `updatePersonalProject` `features/personal/projects/service.ts:162` | 仅本人 | 有测试 `features/personal/projects/service.test.ts:113`（slug 不变）、`:136`（他人抛 DomainError） |
| `deletePersonalProject` `features/personal/projects/service.ts:205` | 仅本人 | 有测试 `features/personal/projects/service.test.ts:153`（级联）、`:136`（他人拒绝） |

### 6.4 `features/personal/projects/actions.ts`

| 函数（file:line） | 鉴权入口 | 结论 |
|---|---|---|
| `createPersonalProjectAction` `features/personal/projects/actions.ts:37` | `requireUser` `:41` | 无测试-低风险（无 actions 单测；service 与 `requireUser` 已测，且未登录 redirect 由 layout e2e 覆盖） |
| `updatePersonalProjectAction` `features/personal/projects/actions.ts:52` | `requireUser` `:56` | 无测试-低风险（同上） |
| `deletePersonalProjectAction` `features/personal/projects/actions.ts:67` | `requireUser` `:70` | 无测试-低风险（同上） |

## 7. tasks 域

### 7.1 `features/tasks/permissions.ts`（任务矩阵唯一实现）

| 函数（file:line） | 矩阵分支 | 结论 |
|---|---|---|
| `canCreateTask` `features/tasks/permissions.ts:37` | 任何成员；非成员拒 | 有测试 `features/tasks/permissions.test.ts:21-28` |
| `canComment` `features/tasks/permissions.ts:42` | 任何成员；非成员拒 | 有测试 `features/tasks/permissions.test.ts:21-28` |
| `canEditTask` `features/tasks/permissions.ts:55` | owner/admin 任意；member 仅本人；未指派 member 不可 | 有测试 `features/tasks/permissions.test.ts:30-58`（三角色 × 本人/他人/未指派） |
| `canDeleteTask` `features/tasks/permissions.ts:60` | 同上 | 有测试 `features/tasks/permissions.test.ts:30-58` |
| `canAssignTask` `features/tasks/permissions.ts:65` | 同上 | 有测试 `features/tasks/permissions.test.ts:30-58` |
| `assertCanEditTask` `features/tasks/permissions.ts:70` | 允许 / 拒绝 | 有测试 `features/tasks/permissions.test.ts:60-73` |
| `assertCanDeleteTask` `features/tasks/permissions.ts:75` | 允许 / 拒绝 | 有测试 `features/tasks/permissions.test.ts:60-73` |
| `assertCanAssignTask` `features/tasks/permissions.ts:80` | 允许 / 拒绝 | 有测试 `features/tasks/permissions.test.ts:60-73` |

### 7.2 `features/tasks/service.ts`（团队任务）

| 函数（file:line） | 矩阵分支 | 结论 |
|---|---|---|
| `createTeamTask` `features/tasks/service.ts:220` | 任何成员可建；指派对象须为成员 | 有测试 `features/tasks/service.test.ts:115`（member 建、默认为自己）、`:144`（指派他人 + 通知）、`:178`（非成员拒）、`:196`（自己不通知）、`:213`（非成员拒） |
| `updateTeamTask` `features/tasks/service.ts:295` | 内容：owner/admin 任意、member 仅本人；改派同矩阵 | 有测试 `features/tasks/service.test.ts:227`（member 本人）、`:244`（member 他人拒）、`:258`（owner 他人 + 通知）、`:285`（原值不产生副作用）、`:319`（owner 本人不通知）、`:331`（owner 改派）、`:360`（member 改派本人）、`:381`（member 改派他人拒）、`:398`（改派非成员拒）；admin 分支仅判定层覆盖 |
| `deleteTeamTask` `features/tasks/service.ts:424` | owner/admin 任意；member 仅本人 | 必修-需评估（`features/tasks/service.test.ts:585-598` 仅断言跨团队拒绝，成功 / 拒绝矩阵由 `features/tasks/permissions.test.ts:30-52` 判定层覆盖；接线为单点 `assertCanDeleteTask`，逐行核对无误，见 §10.1 评估） |
| `addTeamSubtask` `features/tasks/service.ts:448` | 需 `task:edit`（member 仅本人） | 有测试 `features/tasks/service.test.ts:503`（member 他人任务拒）、`:517`/`:526`（本人任务成功） |
| `removeTeamSubtask` `features/tasks/service.ts:476` | 需 `task:edit`；子任务须属于该任务 | 有测试 `features/tasks/service.test.ts:517`/`:543`（删除成功、主任务状态不变） |
| `toggleTeamSubtask` `features/tasks/service.ts:513` | 需 `task:edit`；子任务须属于该任务 | 有测试 `features/tasks/service.test.ts:517`/`:532`（勾选不改主任务 `updatedAt`） |
| `addTeamComment` `features/tasks/service.ts:553` | 任何成员可评论 | 有测试 `features/tasks/service.test.ts:416`（通知责任人）、`:440`（通知幂等）、`:461`/`:470`（非成员拒） |
| `deleteTeamComment` `features/tasks/service.ts:593` | 仅作者本人（owner/admin 也不行） | 有测试 `features/tasks/service.test.ts:474`/`:482-499`（删他人拒、删自己成功） |
| `listTeamProjectTasks` `features/tasks/service.ts:630` | 任何成员可读；非成员空数组 | 有测试 `features/tasks/service.test.ts:552`/`:561`（非成员空）、`:601`（排序 + 子任务 + 责任人）、`:613`/`:641`（列表） |
| `getTeamTaskDetail` `features/tasks/service.ts:683` | 任何成员可读；非成员 / 个人任务 / 跨团队 null | 有测试 `features/tasks/service.test.ts:552`/`:564`（非成员 null）、`:568`/`:581`（个人任务 null）、`:663`/`:682`（详情组装） |

### 7.3 `features/tasks/actions.ts`

| 函数（file:line） | 鉴权入口 | 结论 |
|---|---|---|
| `createTeamTaskAction` `features/tasks/actions.ts:47` | `getCurrentUser` `:55`，`actorId` 覆盖客户端值 `:59` | 有测试 `features/tasks/actions.test.ts:139`（未登录全量）、`:190`（成功 + actorId） |
| `updateTeamTaskAction` `features/tasks/actions.ts:67` | `getCurrentUser` `:78` | 有测试 `features/tasks/actions.test.ts:139`、`:154`（任务权限映射）、`:172`（领域错误） |
| `deleteTeamTaskAction` `features/tasks/actions.ts:90` | `getCurrentUser` `:94` | 有测试 `features/tasks/actions.test.ts:139`、`:163`（团队权限映射）、`:199`（未知异常） |
| `addTeamSubtaskAction` `features/tasks/actions.ts:106` | `getCurrentUser` `:111` | 有测试 `features/tasks/actions.test.ts:139`（未登录族）、`:172` |
| `removeTeamSubtaskAction` `features/tasks/actions.ts:123` | `getCurrentUser` `:128` | 有测试 `features/tasks/actions.test.ts:139`、`:163` |
| `toggleTeamSubtaskAction` `features/tasks/actions.ts:140` | `getCurrentUser` `:146` | 有测试 `features/tasks/actions.test.ts:139`、`:172` |
| `addTeamCommentAction` `features/tasks/actions.ts:158` | `getCurrentUser` `:163` | 有测试 `features/tasks/actions.test.ts:139`、`:186`（成功） |
| `deleteTeamCommentAction` `features/tasks/actions.ts:175` | `getCurrentUser` `:180` | 有测试 `features/tasks/actions.test.ts:139`、`:154` |

### 7.4 `features/personal/tasks/service.ts`（个人任务）

| 函数（file:line） | 矩阵分支 | 结论 |
|---|---|---|
| `createPersonalTask` `features/personal/tasks/service.ts:246` | 归属本人；项目须本人 | 有测试 `features/personal/tasks/service.test.ts:54`（字段 / 归属）、`:102`（他人项目拒）、`:448`（校验） |
| `listPersonalProjectTasks` `features/personal/tasks/service.ts:287` | 仅本人项目 | 有测试 `features/personal/tasks/service.test.ts:393`、`:435`/`:441`（他人项目空）、`:444`（非法 id 空） |
| `getPersonalTaskDetail` `features/personal/tasks/service.ts:337` | 仅本人任务 | 有测试 `features/personal/tasks/service.test.ts:118`（他人 null）、`:197`（组装）、`:262`（无子任务 / 无项目） |
| `updatePersonalTask` `features/personal/tasks/service.ts:415` | 仅本人任务 | 有测试 `features/personal/tasks/service.test.ts:118`（他人拒）、`:275`（部分字段 / 清空 / updatedAt）、`:448`/`:476`（校验） |
| `deletePersonalTask` `features/personal/tasks/service.ts:475` | 仅本人任务 | 有测试 `features/personal/tasks/service.test.ts:118`（他人拒）、`:355`（级联） |
| `addPersonalSubtask` `features/personal/tasks/service.ts:501` | 仅本人任务 | 有测试 `features/personal/tasks/service.test.ts:118`（他人拒）、`:370`（成功）、`:448`/`:473`（校验） |
| `removePersonalSubtask` `features/personal/tasks/service.ts:523` | 仅本人任务；子任务须属于该任务 | 有测试 `features/personal/tasks/service.test.ts:370`、`:384`（跨任务拒）、`:387`（成功） |
| `togglePersonalSubtask` `features/personal/tasks/service.ts:551` | 仅本人任务 | 有测试 `features/personal/tasks/service.test.ts:147`（不动主任务）、`:159`/`:179`（勾选 / 取消） |
| `addPersonalComment` `features/personal/tasks/service.ts:581` | 仅本人任务 | 有测试 `features/personal/tasks/service.test.ts:118`（他人拒）、`:321`（成功）、`:448`/`:467`/`:470`（校验） |
| `deletePersonalComment` `features/personal/tasks/service.ts:603` | 仅作者 / 本人 | 有测试 `features/personal/tasks/service.test.ts:321`、`:345`（非作者拒）、`:349`（成功） |

### 7.5 `features/personal/tasks/actions.ts`

| 函数（file:line） | 鉴权入口 | 结论 |
|---|---|---|
| `createPersonalTaskAction` `features/personal/tasks/actions.ts:48` | `requireUser` `:51` | 无测试-低风险（无 actions 单测；service 已测） |
| `updatePersonalTaskAction` `features/personal/tasks/actions.ts:62` | `requireUser` `:71` | 无测试-低风险（同上） |
| `deletePersonalTaskAction` `features/personal/tasks/actions.ts:82` | `requireUser` `:85` | 无测试-低风险（同上） |
| `addPersonalSubtaskAction` `features/personal/tasks/actions.ts:96` | `requireUser` `:100` | 无测试-低风险（同上） |
| `togglePersonalSubtaskAction` `features/personal/tasks/actions.ts:111` | `requireUser` `:116` | 无测试-低风险（同上） |
| `removePersonalSubtaskAction` `features/personal/tasks/actions.ts:132` | `requireUser` `:136` | 无测试-低风险（同上） |
| `addPersonalCommentAction` `features/personal/tasks/actions.ts:147` | `requireUser` `:151` | 无测试-低风险（同上） |
| `deletePersonalCommentAction` `features/personal/tasks/actions.ts:162` | `requireUser` `:166` | 无测试-低风险（同上） |

## 8. dashboard 域

| 函数（file:line） | 矩阵分支 | 结论 |
|---|---|---|
| `getMyTaskStats` `features/dashboard/my-tasks/service.ts:38` | 按 userId 隔离 | 有测试 `features/dashboard/my-tasks/service.test.ts:305`、`:315`（空） |
| `listMyPersonalTasks` `features/dashboard/my-tasks/service.ts:166` | 按 userId + 本人项目隔离 | 有测试 `features/dashboard/my-tasks/service.test.ts:323`、`:338` |
| `listMyTeamTasks` `features/dashboard/my-tasks/service.ts:186` | 按 assignee 隔离（团队可见性不在此处） | 有测试 `features/dashboard/my-tasks/service.test.ts:366` |
| `listCrossSpaceProjects` `features/dashboard/my-tasks/service.ts:210` | 本人项目 + 所在团队项目 | 有测试 `features/dashboard/my-tasks/service.test.ts:399`（他人 / 非成员团队项目不出现） |
| `getWeekStart` `features/dashboard/my-tasks/service.ts:248` | 无 | 有测试 `features/dashboard/my-tasks/service.test.ts:281`、`:285`、`:289` |
| `getTeamOverview` `features/dashboard/team-overview/service.ts:190` | 只读；函数内**不鉴权**，由调用方成员校验 | 有测试（数据）`features/dashboard/team-overview/service.test.ts:262`、`:304`、`:321`、`:366`、`:440`；唯一调用方 `teams/[teamSlug]/page.tsx:64-66` 在 `getMembership` 后才调用（非成员 404 由页面 e2e 走查覆盖，见 `docs/x-audit-walkthrough.md`） |

## 9. notifications 域

### 9.1 `features/notifications/service.ts`

| 函数（file:line） | 矩阵分支 | 结论 |
|---|---|---|
| `createNotification` `features/notifications/service.ts:24` | 内部写入口；调用方负责收件人 | 有测试（间接）`features/notifications/queries.test.ts:86-101`、`features/teams/invites/service.test.ts:123` |

### 9.2 `features/notifications/queries.ts`

| 函数（file:line） | 矩阵分支 | 结论 |
|---|---|---|
| `buildNotificationHref` `features/notifications/queries.ts:33` | 无；仅由服务端对象拼固定前缀路径 | 有测试 `features/notifications/queries.test.ts:266-337`（表驱动） |
| `getUnreadNotificationCount` `features/notifications/queries.ts:63` | 按 userId | 有测试 `features/notifications/queries.test.ts:83` |
| `listNotifications` `features/notifications/queries.ts:81` | 按 userId | 有测试 `features/notifications/queries.test.ts:108`（本人隔离 + limit）、`:152`、`:169`（href） |
| `markNotificationRead` `features/notifications/queries.ts:182` | 仅本人通知 | 有测试 `features/notifications/queries.test.ts:203` |
| `markAllNotificationsRead` `features/notifications/queries.ts:198` | 仅本人 | 有测试 `features/notifications/queries.test.ts:230` |
| `markTeamInviteNotificationsRead` `features/notifications/queries.ts:212` | 仅本人 + 指定团队 + 类型 | 有测试 `features/notifications/queries.test.ts:243`、`features/teams/invites/service.test.ts:214` |

### 9.3 `features/notifications/due-scan.ts`

| 函数（file:line） | 矩阵分支 | 结论 |
|---|---|---|
| `shanghaiToday` `features/notifications/due-scan.ts:19` | 无 | 有测试 `features/notifications/due-scan.test.ts:231`、`:235` |
| `runDueScan` `features/notifications/due-scan.ts:41` | 全库扫描，仅由 cron 鉴权路由调用 | 有测试 `features/notifications/due-scan.test.ts:94`（逾期 + 幂等）、`:122`（临期窗口）、`:158`（完成 / 未指派跳过）、`:184`（状态迁移）、`:206`（个人任务）；入口鉴权 `app/api/cron/due-scan/route.test.ts:34`、`:44`、`:54` |

### 9.4 `features/notifications/actions.ts`

| 函数（file:line） | 鉴权入口 | 结论 |
|---|---|---|
| `markNotificationReadAction` `features/notifications/actions.ts:23` | `getCurrentUser` `:27` | 有测试 `features/notifications/actions.test.ts:49`（未登录）、`:82`（本人）、`:98`（他人 / 不存在不泄露）、`:109`（异常通用文案） |
| `markAllNotificationsReadAction` `features/notifications/actions.ts:46` | `getCurrentUser` `:50` | 有测试 `features/notifications/actions.test.ts:59`、`:69` |

### 9.5 `app/api/**`

| 入口（file:line） | 鉴权 / 输入校验 | 结论 |
|---|---|---|
| `GET /api/notifications` `apps/web/src/app/api/notifications/route.ts:37` | 未登录 401（`:38-41`）；limit 仅接受 1..100 整数，其余回落 20（`:17-28`）；只查会话 userId | 有测试 `apps/web/src/app/api/notifications/route.test.ts:49`（401 且不查库）、`:60`（默认 20）、`:73-84`（非法 limit）、`:86`（合法透传） |
| `POST /api/cron/due-scan` `apps/web/src/app/api/cron/due-scan/route.ts:17` | `isAuthorizedCronRequest` 失败 401 且不扫描（`:18-20`）；仅导出 POST | 有测试 `apps/web/src/app/api/cron/due-scan/route.test.ts:34`（无密钥）、`:44`（错密钥）、`:54`（未配置）、`:77`（扫描异常 500） |
| `isAuthorizedCronRequest` `apps/web/src/app/api/cron/due-scan/auth.ts:14` | `CRON_SECRET` 未配置或空串一律拒绝（`:15-17`）；Bearer / x-cron-key 完全匹配（`:20-24`） | 有测试 `apps/web/src/app/api/cron/due-scan/auth.test.ts:30`（未配置）、`:40`（空串）、`:46`（Bearer）、`:54`（x-cron-key）、`:60-64`（错误值） |

## 10. 设计 §5 角色矩阵覆盖对照

判定层由 `features/teams/permissions.test.ts:11-46`（8 个团队动作 × 3 角色 + null 全表）
与 `features/tasks/permissions.test.ts:20-58`（任务动作 × 角色 × 本人/他人/未指派）表驱动覆盖，
**矩阵判定层无未测分支**。下表核对到 service 接线层：

| §5 操作 | 实现函数 | 判定层 | service 接线层 |
|---|---|---|---|
| 修改团队设置（改名） owner/admin | `teams/service.ts:168` | 有测试 | owner 成功 / member / 非成员有测试；admin 成功未集成断言 |
| 邀请成员 owner/admin | `invites/service.ts:66` | 有测试 | 有测试（owner + admin 均通过权限，member 拒） |
| 撤销邀请 owner/admin | `invites/service.ts:151` | 有测试 | owner 成功 + member 拒有测试；admin 成功未集成断言 |
| 移除成员 owner/admin | `members/service.ts:125` | 有测试 | admin 成功 / member 拒 / owner 目标拒有测试；owner 成功未集成断言 |
| 创建/编辑/删除团队项目 owner/admin | `projects/service.ts:138/184/232` | 有测试 | 创建：owner/admin 均测；编辑/删除：owner 成功 + member 拒，admin 成功未集成断言 |
| 解散团队 owner | `members/service.ts:255` | 有测试 | 有测试（owner 成功、admin/member 拒） |
| 转让团队 owner | `members/service.ts:198` | 有测试 | 有测试（owner 成功、admin/member 拒、本人/非成员受让人） |
| 在项目中创建任务 任意成员 | `tasks/service.ts:220` | 有测试 | 有测试（member 成功、非成员拒；owner 在夹具中多次成功） |
| 建任务时指派责任人 任意成员 | `tasks/service.ts:220` | 有测试 | 有测试（指派他人 / 非成员拒 / 自己） |
| 编辑任务内容 owner/admin 任意、member 本人 | `tasks/service.ts:295` | 有测试 | member 本人 / 他人拒、owner 他人有测试；admin 任意未集成断言 |
| 删除任务 owner/admin 任意、member 本人 | `tasks/service.ts:424` | 有测试 | **未测**（service 仅跨团队拒绝，矩阵接线未断言） |
| 发表评论 任意成员 | `tasks/service.ts:553` | 有测试 | 有测试（member 成功、非成员拒） |
| 查看团队概览/项目/任务 任意成员 | `team-overview/service.ts:190`、`tasks/service.ts:630/683` | 有测试 | 有测试（非成员空 / null；概览为调用方守卫 + 页面走查） |
| 主动退出团队 owner 受限、admin/member | `members/service.ts:163` | 有测试 | member 成功 / owner 拒 / 非成员拒有测试；admin 成功未集成断言 |
| 个人项目仅本人（§7） | `personal/projects/service.ts` 全部函数 | 无角色矩阵，按 ownerId 隔离 | 有测试（创建/读取/更新/删除的他人拒绝均覆盖） |

### 10.1 矩阵接线缺口评估（必修-需评估，结论：无需代码修复）

以下 8 处「owner/admin 写路径」缺 service 集成断言。它们全部经过同一个已表驱动测试的
判定原语（`assertCan` / `assertCanEditTask` / `assertCanAssignTask` / `assertCanDeleteTask`），
service 侧只是把 `getMembership` 的结果与任务当前责任人传入；本次逐行核对未发现参数错位、
角色写反或漏调用。**结论：不是实证缺陷，无需改代码**；建议后续补集成测试（选修）。

1. `renameTeam` admin 成功分支（`teams/service.ts:174-175`）。
2. `rescindInvite` admin 成功分支（`invites/service.ts:156`，`assertCan(..., "team:invite")` 的两处接线点之一；`createInvite` 在 `:76` 调用同一判定，测试均仅以 owner / member 作 actor）。
3. `removeMember` owner 成功分支（`members/service.ts:131-132`）。
4. `leaveTeam` admin 成功分支（`members/service.ts:168-174`）。
5. `updateTeamTask` admin 编辑他人任务分支（`tasks/service.ts:352-358`）。
6. `deleteTeamTask` 全矩阵（owner/admin 任意、member 本人；`tasks/service.ts:431-435`）。
7. `updateTeamProject` admin 成功分支（`projects/service.ts:194`）。
8. `deleteTeamProject` admin 成功分支（`projects/service.ts:236`）。

## 11. 基础设施核查

### 11.1 会话 cookie（httpOnly / secure / sameSite / 签名）

| 检查 | 证据 | 判定 |
|---|---|---|
| httpOnly | `features/auth/session.ts:21` | 通过 |
| sameSite | `features/auth/session.ts:22`（`lax`） | 通过 |
| secure | `features/auth/session.ts:23`（仅 `NODE_ENV === "production"` 为 true） | 通过；本地 HTTP 开发/Compose 需 false（`docker-compose.yml:74` 显式 development） |
| path / maxAge | `features/auth/session.ts:24-25`（`/`；30 天） | 通过 |
| 写入 / 清除 | `features/auth/session.ts:76-80`、`:96-102` | 通过 |
| 签名 | `features/auth/session.ts:46-55`（jose `SignJWT`，HS256，payload 仅 `{ userId }`）；`:66` 验签固定 `algorithms: ["HS256"]` | 通过（签名由 JWT 承担，不使用 Next `signed` cookie 选项） |
| 密钥 | `features/auth/session.ts:34-43`：生产缺失 `SESSION_SECRET` 直接抛错；开发回退固定密钥 | 通过（生产强制配置） |
| 测试 | `features/auth/session.test.ts:44-55`（httpOnly/lax/30 天/根路径；测试环境 secure=false）、`:31`（异密钥）、`:37`（篡改） | 通过 |

残留观察（选修-不修）：无状态会话不可撤销（登出只清客户端 cookie，被窃 token 到期前仍有效，
设计取舍见 `session.ts:8-13`）；cookie 名未使用 `__Host-` 前缀（单域部署下风险低）。

### 11.2 argon2 参数与注册一致性

| 检查 | 证据 | 判定 |
|---|---|---|
| 注册哈希 | `features/auth/service.ts:136` `hash(password)`（`@node-rs/argon2` 默认参数 = Argon2id） | 通过 |
| 登录校验 | `features/auth/service.ts:185` `verify(credentials.passwordHash, password)`：参数从库内编码串读取，与注册参数必然一致 | 通过 |
| seed 一致性 | `server/db/seed.ts:524` `hash(SEED_PASSWORD)` 同样使用默认参数 | 通过（注释 `seed.ts:18` 明示） |
| 测试 | `features/auth/service.test.ts:55`（落库以 `$argon2id$` 开头、非明文） | 通过 |
| 明文风险 | 全仓仅 `service.ts` / `seed.ts` 调用 `hash`，无其他密码落库路径（grep `argon2|hash(`） | 通过 |

残留观察（选修-不修）：密码只校验最短 8 位，无最大长度上限（`features/auth/constants.ts:13`）；
超长密码会放大 argon2 CPU 成本，属限流问题而非认证绕过。

### 11.3 cron 密钥空值拒绝

| 检查 | 证据 | 判定 |
|---|---|---|
| 未配置 / 空串拒绝 | `app/api/cron/due-scan/auth.ts:15-17`：`if (!secret) return false` | 通过 |
| 路由失败即 401 且不扫描 | `app/api/cron/due-scan/route.ts:18-20`、`:22-28` | 通过 |
| 两种取钥头 | `app/api/cron/due-scan/auth.ts:20-24`（Bearer / x-cron-key） | 通过 |
| 测试 | `app/api/cron/due-scan/auth.test.ts:30`（未配置）、`:40`（空串）、`:46`、`:54`、`:60-64`；`route.test.ts:34`、`:44`、`:54` | 通过 |

残留观察（选修-不修）：密钥比较为普通字符串相等（`auth.ts:20,24`），未用
`timingSafeEqual`；密钥为高熵服务端配置且仅暴露给 cron 调用方，风险低。

### 11.4 UID 不可枚举（注册 / 邀请错误文案）

| 检查 | 证据 | 判定 |
|---|---|---|
| UID 随机源 | `lib/uid.ts:1`（`node:crypto`）、`:7-9`（31 字符集、6 位、剔除易混淆字符）、`:16-30`（拒绝采样，无模偏差）；空间 31^6 ≈ 8.9×10^8；测试 `lib/uid.test.ts:5`/`:8`（格式 / 字符集与长度）、`:14`（500 次调用互不相同） | 通过 |
| 注册不泄露 UID 冲突 | `features/auth/service.ts:138-159`：UID 唯一冲突静默重试（最多 5 次）；耗尽只返回通用「系统繁忙」`:161-165`；用户名冲突才给 `USERNAME_TAKEN` | 通过 |
| 登录统一文案 | `features/auth/service.ts:73-75`、`:178-191`；`features/auth/constants.ts:17`；测试 `features/auth/service.test.ts:118-139` | 通过 |
| 邀请：格式错误 / 不存在统一文案 | `features/teams/invites/service.ts:70-73`（空）、`:78-81`（不存在）均 `UID 无效`；测试 `features/teams/invites/service.test.ts:80-90`（空 / 非前缀 / 不存在三种同文案） | 通过 |
| 邀请查询精确匹配 | `features/users/service.ts:35-41`（`eq(users.uid, uid)`，无 LIKE / 前缀查询） | 通过 |
| 邀请其他错误不泄露存在性之外的信息 | 自己 / 已是成员 / 重复 pending 的文案只描述当前团队关系（`:82-102`）；「已存在该 UID」本身的确认是邀请功能的必要反馈，且调用者必须是该团队 owner/admin | 可接受 |

残留观察（选修-不修）：邀请接口对 owner/admin 天然可判断「UID 存在 / 不存在」以及
「是否已是本团队成员」，这是按 UID 邀请的必要反馈，不构成对匿名攻击者的枚举面；
注册接口仍会因「用户名已存在」泄露用户名存在性（用户名本身在团队成员列表可见，非 UID）。

### 11.5 SQL 注入面（Drizzle 参数化）

Drizzle `sql` 模板中的普通值走 `Param` 绑定；只有 `sql.raw` / `shouldInlineParams` 才内联。
全仓无 `sql.raw`、无 `shouldInlineParams`（grep 为空）。实证：用恶意日期值构造查询，
生成 SQL 为 `... < $1::date`，恶意串原样进入 `params` 数组而非 SQL 文本：

```
sql:    select count(*)::int from "tasks" where "tasks"."due_date" < $1::date
params: ["2020-01-01::date)::int; DROP TABLE users; --"]
```

逐处 `sql` 模板：

| 位置 | 内容 | 判定 |
|---|---|---|
| `features/dashboard/my-tasks/service.ts:47-54` | `count filter` + `${today}` / `${tomorrow}` / `${weekStart}` 值绑定 | 参数化，通过 |
| `features/dashboard/my-tasks/service.ts:107-110` | `count(*)` / `count(*) filter` 静态片段 | 无外部值，通过 |
| `features/dashboard/my-tasks/service.ts:128-129` | `coalesce(...)::int` 列引用 | 通过 |
| `features/dashboard/my-tasks/service.ts:137` | `orderBy` 列引用 `nulls last` | 通过 |
| `features/dashboard/my-tasks/service.ts:234` | `case when ${projects.teamId} is null ...` 列引用 | 通过 |
| `features/dashboard/team-overview/service.ts:108-110`、`:128-129`、`:136` | 同上（聚合列、列引用排序） | 通过 |
| `features/teams/invites/service.ts:311` | 子查询内表 / 列引用（成员数） | 通过 |
| `features/teams/invites/service.ts:319` | `case when ${teamInvites.status} = 'pending'` 列引用 + 字面量 | 通过 |
| `server/db/schema.ts:94/113/118/121/198` | 部分唯一索引 / CHECK 约束定义，均为列引用 + 字面量 | 通过（非请求数据） |
| `server/db/testing.ts:40` | 测试库 `TRUNCATE` 静态表名 | 通过（仅测试，无插值） |

`like(teams.slug, ...)` 的 `%` 只拼接在服务端生成的 ASCII slug 之后（`lib/slug.ts:19-24`
先剥离非 `[a-z0-9]`），且值本身仍参数化。结论：未发现注入面。

### 11.6 XSS

| 检查 | 结果 |
|---|---|
| `dangerouslySetInnerHTML` | 全仓（`apps/**`、`packages/**` 的 `.ts/.tsx`）计数 **0** |
| `innerHTML` / `document.write` / `eval(` / `new Function` | 计数 0 |
| 用户内容渲染 | 标题 / 描述 / 评论 / 用户名均以 React JSX 文本节点渲染，自动转义 |
| 链接拼接 | 通知 href 固定前缀 + 服务端 slug（`features/notifications/queries.ts:33-60`）、我的任务 href（`my-tasks/service.ts:81-92`）、团队概览 href（`team-overview/service.ts:157-163`）；slug 仅含 `[a-z0-9-]`（`lib/slug.ts:19-24`），无 `javascript:` 注入面 |
| 结论 | 通过（零 sink） |

### 11.7 其他观察（选修-不修）

- 无 CSP / HSTS / `X-Frame-Options` 等安全响应头（`apps/web/next.config.ts` 未配置，无
  `middleware.ts`）。不构成本次范围内的实证缺陷；上线前建议在反向代理或 Next 配置补齐。
- 登录 / 注册 / 邀请无速率限制（全仓无 rate-limit 实现），暴力破解与 UID 探测成本仅由
  argon2 与网络延迟承担；v1 未要求，建议部署层限流。
- 成员被移除 / 退出后，其历史 `notifications` 行保留（`notifications` 外键只在团队 /
  项目 / 任务删除时级联，`members/service.ts:82-110` 不删通知）。通知中心仍可显示该团队的
  历史团队名 / 任务标题，与设计 §6「不再能看到团队任何数据」存在口径张力；但设计对
  「删除项目 / 解散团队」明确要求级联删除通知，对「移除成员」未要求，故按历史消息保留，
  本次不修改（如需严格口径，选修项：移除成员时删除该用户在该团队的通知）。

## 12. 结论汇总

- **必修-已修复：0**。逐函数、基础设施六项均未发现可实证的鉴权绕过、注入或 XSS；
  因此没有代码修复 commit。
- **必修-需评估：8**（§10.1，均为 service 集成测试缺口，判定原语已测，逐行核对无参数
  错位；评估结论为无需改代码，补测列为选修）。
- **矩阵判定层无测试分支：0**（`permissions.test.ts` 表驱动覆盖全部团队动作 × 角色；
  `tasks/permissions.test.ts` 覆盖任务动作 × 角色 × 本人/他人/未指派）。
- **逐函数「无测试-低风险」：20**：
  - auth service `logout` 1；
  - session `getSessionSecret` / `createSession` / `getSessionUserId` / `clearSession` /
    `getCurrentUser` 5（cookie API、无法在 node 单测中直接执行；`requireUser` 由 e2e 采样覆盖）；
  - auth actions 3；
  - personal projects actions 3；
  - personal tasks actions 8。
- 其余 70 余个服务函数均有直接或间接自动化断言（见 §3-§9）。
- 验证命令与结果见实施报告 `.superpowers/sdd/2026-10-24-track-x-wrapup/task-5-report.md`。

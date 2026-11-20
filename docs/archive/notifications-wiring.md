# 通知接线清单（INT-2 核验）

本清单由 N 线（N-1）维护，集成负责人在 **INT-2** 按行核验：每个接线点存在、触发条件正确、接收人与关联对象参数无误。表中路径均相对 `apps/web/src/`。

| 接线点 | 条件 | 通知谁 | 关联对象 |
|---|---|---|---|
| `features/teams/invites/service.ts` `createInvite` | 邀请发出（owner/admin 发起且通过校验） | invitee | `teamId`，`actorId=invitedBy`；`taskId=null` |
| 同上 `respondToInvite` | 邀请被接受/拒绝（同事务） | —（把 invitee 的 `team_invite` 通知置为已读；不通知自己，邀请人另由既有 `team_invite` 通知覆盖） | `teamId` |
| `features/tasks/service.ts` 创建/改派（`createTeamTask` / `updateTeamTask`） | assignee≠actor | assignee，`task_assigned` | `teamId` / `projectId` / `taskId` / `actorId` |
| 同上 owner/admin 编辑他人任务 | 有字段变更，且当前责任人≠actor | 当前责任人（≠actor），`task_changed_by_admin` | 同上 |
| 同上 评论（`addTeamComment`） | author≠task 责任人 | 当前责任人（非 author），`task_commented` | 同上 |
| `features/notifications/due-scan.ts`（Task 5） | 临期/逾期 | assignee（个人 + 团队全空间） | `taskId`，`actorId=null` |

## 口径

- **邀请接受不通知自己**：`respondToInvite` 只为邀请人写入 `team_invite` 通知；被邀请人一侧仅做已读清理（`markTeamInviteNotificationsRead`），不产生新的通知行。
- **评论不通知本人**：`addTeamComment` 仅当任务责任人存在且与作者不同时通知责任人。
- **个人空间只产生到期类提醒**：个人任务服务没有 `createNotification` 调用点，除 `due-scan.ts` 的临期/逾期提醒外，个人空间不会产生通知。
- **同事务**：以上业务写入与通知写入（含邀请已读清理）均通过调用方传入的 `tx` client 在同一事务内提交/回滚（INT-1 核验点）。
- **关联对象缺失**：通知缺少 `taskId` 时，前端跳转由 `buildNotificationHref` 回落为 `null`，不拼接无效链接。
- `due-scan.ts` 由 Task 5 落地；在 Task 5 合并前，INT-2 按本行的约定核验其接线参数。

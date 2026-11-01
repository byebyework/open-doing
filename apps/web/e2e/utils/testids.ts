/**
 * e2e 专用 data-testid 常量表。
 *
 * 约定：spec 中定位一律 `getByTestId(TEST_IDS.xxx)`，禁止裸字符串 testid；
 * 组件侧硬编码同名字面量（不 import 本文件，保持产品代码与测试代码解耦）。
 * 命名 kebab-case 语义化，与界面文案无关——文案改了定位不坏。
 */
export const TEST_IDS = {
  auth: {
    usernameInput: "auth-username-input",
    passwordInput: "auth-password-input",
    passwordConfirmInput: "auth-password-confirm-input",
    submitButton: "auth-submit-button",
  },
  projects: {
    newPersonalProjectButton: "new-personal-project-button",
    projectNameInput: "personal-project-name-input",
    projectSubmitButton: "personal-project-submit-button",
  },
  tasks: {
    newTaskButton: "new-task-button",
    titleInput: "task-title-input",
    dueDateInput: "task-due-date-input",
    createSubmitButton: "task-create-submit-button",
    subtaskHeading: "subtask-heading",
    subtaskInput: "subtask-input",
    subtaskAddButton: "subtask-add-button",
  },
  kanban: {
    columnTodo: "kanban-column-todo",
    columnInProgress: "kanban-column-in-progress",
    columnDone: "kanban-column-done",
  },
  teams: {
    createTeamHeading: "create-team-heading",
    teamNameInput: "team-name-input",
    createTeamButton: "create-team-button",
    inviteUidInput: "invite-uid-input",
    inviteSendButton: "invite-send-button",
    invitePendingHeading: "invite-pending-heading",
    inviteAcceptButton: "invite-accept-button",
    inviteDeclineButton: "invite-decline-button",
    invitesEmpty: "invites-empty",
    accountUid: "account-uid",
  },
  teamDanger: {
    dissolveTeamButton: "dissolve-team-button",
    dissolveConfirmInput: "dissolve-confirm-input",
    dissolveConfirmButton: "dissolve-confirm-button",
  },
  shell: {
    spaceSwitcherTrigger: "space-switcher-trigger",
    notificationBellButton: "notification-bell-button",
  },
  misc: {
    notFoundMessage: "not-found-message",
  },
} as const;

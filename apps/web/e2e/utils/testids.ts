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
    nicknameInput: "auth-nickname-input",
    passwordInput: "auth-password-input",
    passwordConfirmInput: "auth-password-confirm-input",
    registrationCodeInput: "auth-registration-code-input",
    submitButton: "auth-submit-button",
  },
  projects: {
    newPersonalProjectButton: "new-personal-project-button",
    projectNameInput: "personal-project-name-input",
    projectSubmitButton: "personal-project-submit-button",
    teamProjectNameInput: "team-project-name-input",
    teamProjectSubmitButton: "team-project-submit-button",
  },
  tasks: {
    newTaskButton: "new-task-button",
    titleInput: "task-title-input",
    dueDateInput: "task-due-date-input",
    createSubmitButton: "task-create-submit-button",
    statusToggle: "task-status-toggle",
    editOpenButton: "task-edit-open",
    subtaskHeading: "subtask-heading",
    subtaskInput: "subtask-input",
    subtaskAddButton: "subtask-add-button",
    cardStatusButton: (status: "todo" | "in_progress" | "done") =>
      `task-status-button-${status}`,
  },
  kanban: {
    columnTodo: "kanban-column-todo",
    columnInProgress: "kanban-column-in-progress",
    columnDone: "kanban-column-done",
    spaceColumnTodo: "space-kanban-column-todo",
    spaceColumnInProgress: "space-kanban-column-in-progress",
    spaceColumnDone: "space-kanban-column-done",
    projectFilter: "kanban-project-filter",
    assigneeFilter: "kanban-assignee-filter",
  },
  calendar: {
    prevMonth: "calendar-prev-month",
    nextMonth: "calendar-next-month",
    today: "calendar-today",
    weekCard: "calendar-week-card",
    gridScroll: "calendar-grid-scroll",
    scrollShadow: "calendar-scroll-shadow",
  },
  analysis: {
    range: (value: 7 | 30 | 90) => `analysis-range-${value}`,
  },
  settings: {
    oldPasswordInput: "settings-old-password-input",
    newPasswordInput: "settings-new-password-input",
    confirmPasswordInput: "settings-confirm-password-input",
    updatePasswordButton: "settings-update-password-button",
    languageSelect: "language-select",
    dueSoonSwitch: "settings-due-soon-switch",
    overdueSwitch: "settings-overdue-switch",
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
    memberRemoveButton: "member-remove-button",
    memberRemoveConfirmButton: "member-remove-confirm-button",
    joinCodeValue: "join-code-value",
    joinCodeSwitch: "join-code-switch",
    joinCodeInput: "join-code-input",
    joinSubmitButton: "join-submit-button",
  },
  teamDanger: {
    dissolveTeamButton: "dissolve-team-button",
    dissolveConfirmInput: "dissolve-confirm-input",
    dissolveConfirmButton: "dissolve-confirm-button",
  },
  shell: {
    spaceSwitcherTrigger: "space-switcher-trigger",
    notificationBellButton: "notification-bell-button",
    userMenuButton: "user-menu-button",
    userMenuSettings: "user-menu-settings",
  },
  misc: {
    notFoundMessage: "not-found-message",
  },
} as const;

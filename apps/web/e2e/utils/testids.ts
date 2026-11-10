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
    emailInput: "auth-email-input",
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
  landing: {
    hero: "landing-hero",
    features: "landing-features",
    faq: "landing-faq",
    cta: "landing-cta",
    langEn: "language-switch-en",
    langZh: "language-switch-zh",
    /**
     * 三个注册入口 CTA（导航 / 首屏 / 底部）的 data-testid，产品组件侧
     * 硬编码同名字面量。spec 既有定位是 **CSS 选择器** `a[href="/register"]`
     * （见 registerLinks）——它依然有效，新定位可改用这些 testid。
     */
    registerNav: "landing-register-nav",
    registerHero: "landing-register-hero",
    registerCta: "landing-register-cta",
    /** 旧定位：区块作用域内的注册链接 CSS 选择器（避免依赖界面文案）。 */
    registerLinks: 'a[href="/register"]',
  },
  misc: {
    notFoundMessage: "not-found-message",
  },
} as const;

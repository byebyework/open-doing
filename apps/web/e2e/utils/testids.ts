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
    projectsListPage: "projects-list-page",
    projectsNewTeamButton: "projects-new-team-button",
    projectsListCard: "projects-list-card",
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
    /** 新建 / 编辑弹窗里的优先级 Select 触发器。 */
    prioritySelect: "task-priority-select",
    /** 列表页优先级 chip（含 data-priority 档位）。 */
    priorityChip: "priority-chip",
    /** 看板卡优先级色点（含 data-priority 档位）。 */
    priorityDot: "priority-dot",
    /** 任务详情页优先级 MetaRow 的 Select 触发器（可编辑时渲染）。 */
    detailPrioritySelect: "detail-priority-select",
    /** 列表页状态列的下拉触发器（StatusTag 徽标本体）。 */
    statusMenuTrigger: "status-menu-trigger",
    /** 操作列编辑按钮。 */
    rowEdit: "row-edit",
    /** 操作列删除按钮（无删除权时不渲染）。 */
    rowDelete: "row-delete",
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
  admin: {
    /** 用户列表搜索框（停止输入后写回 `?q=`）。 */
    usersSearch: "admin-users-search",
    /** 用户列表状态分段按钮（all / active / disabled）。 */
    usersStatus: (status: "all" | "active" | "disabled") =>
      `admin-users-status-${status}`,
    /** 注册码页「新增注册码」按钮与弹窗字段。 */
    createCodeTrigger: "create-code-trigger",
    codeMaxUsesInput: "code-max-uses-input",
    createCodeSubmit: "create-code-submit",
    /** 注册码行「使用者」展开按钮（按码值命名）。 */
    codeUsersToggle: (code: string) => `code-users-toggle-${code}`,
    /** 用户详情页的禁用 / 解禁按钮与确认弹窗确认钮。 */
    userDisable: "user-disable",
    userEnable: "user-enable",
    userActionConfirm: "user-action-confirm",
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

import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import zh from "@/i18n/messages/zh.json";

import type { TaskDetailModel, TaskDetailPermissions } from "./types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { TaskDetailView } = await import("./TaskDetailView");

const task: TaskDetailModel = {
  id: "11111111-1111-1111-1111-111111111111",
  projectId: "22222222-2222-2222-2222-222222222222",
  spaceType: "team",
  title: "整理项目里程碑",
  status: "todo",
  priority: "medium",
  assigneeId: "33333333-3333-3333-3333-333333333333",
  assigneeName: "owner_smoke",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  projectName: "官网改版",
  progress: 0,
  subtasks: [],
  comments: [],
  creatorName: "owner_smoke",
};

const readOnly: TaskDetailPermissions = {
  canEdit: false,
  canDelete: false,
  canAssign: false,
};

function render(
  permissions: TaskDetailPermissions,
  overrides: Partial<TaskDetailModel> = {},
): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="zh"
      messages={zh}
      now={new Date("2026-10-01T00:00:00.000Z")}
    >
      <TaskDetailView
        task={{ ...task, ...overrides }}
        space="team"
        permissions={permissions}
        onAction={{
          toggleSubtask: async () => {},
          updateStatus: async () => {},
          updateTask: async () => {},
          deleteTask: async () => {},
          addComment: async () => {},
          deleteComment: async () => {},
          addSubtask: async () => {},
          removeSubtask: async () => {},
        }}
        currentUserId="44444444-4444-4444-4444-444444444444"
      />
    </NextIntlClientProvider>,
  );
}

describe("TaskDetailView 状态控件权限门", () => {
  it("canEdit=false 时不渲染「更改」入口与「标记为已完成」按钮", () => {
    const html = render(readOnly);

    expect(html).not.toContain("更改");
    expect(html).not.toContain("标记为已完成");
  });

  it("canEdit=true 时两者都渲染", () => {
    const html = render({ canEdit: true, canDelete: true, canAssign: true });

    expect(html).toContain("更改");
    expect(html).toContain("标记为已完成");
  });
});

describe("TaskDetailView 优先级行", () => {
  it("元信息渲染优先级行（chip 档位）", () => {
    const html = render(readOnly, { priority: "high" });

    expect(html).toContain("优先级");
    expect(html).toContain('data-priority="high"');
  });

  it("可编辑时渲染优先级选择器", () => {
    const html = render({ canEdit: true, canDelete: true, canAssign: true });

    expect(html).toContain('data-testid="detail-priority-select"');
  });
});

describe("TaskDetailView 负责人信息处邮箱", () => {
  it("责任人填写邮箱时渲染在负责人信息处", () => {
    const html = render(readOnly, { assigneeEmail: "owner@example.com" });

    expect(html).toContain("owner@example.com");
  });

  it("责任人未填写邮箱时不渲染邮箱行", () => {
    const html = render(readOnly, { assigneeEmail: null });

    expect(html).not.toContain("owner@example.com");
  });
});

describe("TaskDetailView 子任务权限门", () => {
  const subtask = {
    id: "55555555-5555-5555-5555-555555555555",
    taskId: task.id,
    title: "输出评审意见文档",
    completed: false,
    createdAt: "2026-10-01T00:00:00.000Z",
  };

  it("canEdit=false 时子任务只读：不可勾选、不可增删", () => {
    const html = render(readOnly, { subtasks: [subtask] });

    expect(html).not.toContain("＋ 添加子任务");
    expect(html).not.toContain(">删除<");
    // shadcn Checkbox 的禁用态体现在 data-slot 按钮的 disabled 属性上。
    expect(html).toMatch(/role="checkbox"[^>]*data-disabled=""/);
  });

  it("canEdit=true 时子任务可勾选、可增删", () => {
    const html = render(
      { canEdit: true, canDelete: true, canAssign: true },
      { subtasks: [subtask] },
    );

    expect(html).toContain("＋ 添加子任务");
    expect(html).toContain(">删除<");
    expect(html).not.toMatch(/role="checkbox"[^>]*data-disabled=""/);
  });
});

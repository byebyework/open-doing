import { expect, test } from "@playwright/test";

import { E2E_MCP_BASE_URL } from "../utils/env";
import { TEST_IDS } from "../utils/testids";
import { registerUser, uniqueLabel, uniqueUsername } from "../utils/flows";

/**
 * 关键流 15：虚拟团队 + MCP 全链路（Task 19 验收）。
 *
 * 覆盖（对照计划 Task 19 与 spec 验收清单）：
 * 1. 注册后创建虚拟团队（kind 单选）→ 设置页添加虚拟成员 → 建项目 →
 *    建任务并指派给虚拟成员（责任人下拉的「虚拟成员」分组）；
 * 2. 看板卡渲染虚拟成员头像（机器人角标）与名称；
 * 3. 设置页为虚拟成员签发 API Token，从一次性弹窗截取原文并关闭；
 * 4. 用 Playwright request 直接 POST 独立 MCP 服务（`http://127.0.0.1:3101/`）：
 *    JSON-RPC `initialize`
 *    （serverInfo 断言）→ `tools/call whoami`（团队 / 虚拟成员名）→
 *    `tools/call list_tasks` 取任务 id → `tools/call update_task_status`；
 * 5. 页面刷新后看板卡进入「进行中」列（状态已落库），通知铃出现
 *    虚拟成员署名的 agent 活动通知；
 * 6. 错误 Token → 401（不泄露凭据）。
 *
 * e2e 库由 global-setup 清空且不跑 seed，因此本流与其它流一致自建账号，
 * 不依赖种子用户（林夏）。
 */
test.describe.configure({ timeout: 120_000 });

/** MCP Streamable HTTP 客户端的标准 Accept 头：必须同时声明两种类型。 */
const MCP_ACCEPT = "application/json, text/event-stream";

/** 独立 MCP 服务的根端点（不在 web 的 baseURL 上，必须写绝对地址）。 */
const MCP_ENDPOINT = `${E2E_MCP_BASE_URL}/`;

/** POST 一个 JSON-RPC 请求到无状态 MCP 端点（Bearer 鉴权）。 */
async function mcpPost(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  payload: Record<string, unknown>,
) {
  return request.post(MCP_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: MCP_ACCEPT,
    },
    data: payload,
  });
}

/**
 * 调用 MCP 工具并解析文本载荷。
 *
 * `tools/call` 的响应体是 JSON-RPC envelope，工具返回值序列化在
 * `result.content[0].text`（JSON 字符串）里；失败分支带 `isError`。
 */
async function callTool(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  id: number,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await mcpPost(request, token, {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  });
  expect(response.status()).toBe(200);

  const body = (await response.json()) as {
    error?: unknown;
    result?: {
      isError?: boolean;
      content?: { type: string; text?: string }[];
    };
  };
  expect(body.error).toBeUndefined();
  expect(body.result?.isError).not.toBe(true);

  const text = body.result?.content?.[0]?.text;
  expect(typeof text).toBe("string");
  return JSON.parse(text as string);
}

test.describe("flow 15: 虚拟团队与 MCP", () => {
  test("虚拟成员全链路:建团队/成员/项目/任务 → 签发 token → MCP 读写 → UI 状态与通知", async ({
    page,
    request,
  }) => {
    const username = uniqueUsername("e2e_mcp15");
    const teamName = uniqueLabel("E2E mcp team");
    const memberName = uniqueLabel("E2E agent");
    const projectName = uniqueLabel("E2E mcp project");
    const taskTitle = uniqueLabel("E2E mcp task");

    await registerUser(page, username);

    // ===== 1) 创建虚拟团队 =====
    await page.goto("/teams/new");
    await page.getByTestId(TEST_IDS.teams.teamNameInput).fill(teamName);
    await page.getByTestId(TEST_IDS.teams.teamKindVirtual).click();
    await page.getByTestId(TEST_IDS.teams.createTeamButton).click();
    await expect(page).toHaveURL(/\/space\/[^/]+\/settings$/, {
      timeout: 30_000,
    });
    const teamSlug = decodeURIComponent(
      new URL(page.url()).pathname.split("/")[2] ?? "",
    );
    expect(teamSlug).not.toBe("");

    // ===== 2) 设置页添加虚拟成员 =====
    await page.getByTestId(TEST_IDS.virtualMembers.addButton).click();
    const memberDialog = page.getByRole("dialog");
    await expect(memberDialog).toBeVisible();
    await memberDialog
      .getByTestId(TEST_IDS.virtualMembers.nameInput)
      .fill(memberName);
    await memberDialog.getByTestId(TEST_IDS.virtualMembers.submitButton).click();
    await expect(memberDialog).toBeHidden();
    // 虚拟成员列表行出现（名称同时也会出现在下方的 Token 管理行，需按行定位）。
    await expect(
      page
        .getByTestId(TEST_IDS.virtualMembers.rowPattern)
        .filter({ hasText: memberName }),
    ).toBeVisible();

    // ===== 3) 建团队项目 =====
    await page.goto(`/space/${teamSlug}/projects/new`);
    await page
      .getByTestId(TEST_IDS.projects.teamProjectNameInput)
      .fill(projectName);
    await page.getByTestId(TEST_IDS.projects.teamProjectSubmitButton).click();
    // `/projects/new` 也匹配「项目详情」的正则，等标题确认已进入详情页再取路径。
    await expect(
      page.getByRole("heading", { name: projectName, level: 1 }),
    ).toBeVisible({ timeout: 30_000 });
    const projectPath = new URL(page.url()).pathname;
    expect(projectPath).not.toMatch(/\/projects\/new$/);

    // ===== 4) 建任务并指派给虚拟成员 =====
    await page.getByTestId(TEST_IDS.tasks.newTaskButton).click();
    const taskDialog = page.getByRole("dialog");
    await expect(taskDialog).toBeVisible();
    await taskDialog.getByTestId(TEST_IDS.tasks.titleInput).fill(taskTitle);
    // 责任人下拉：虚拟成员以分组选项出现（文案即被测的可发现性）。
    await taskDialog.getByLabel("责任人").click();
    await page.getByRole("option", { name: memberName, exact: true }).click();
    await taskDialog.getByTestId(TEST_IDS.tasks.createSubmitButton).click();
    await expect(taskDialog).toBeHidden();

    // ===== 5) 看板卡：虚拟头像（机器人角标）+ 名称 =====
    await page.goto(`${projectPath}?view=board`);
    const todoColumn = page.getByTestId(TEST_IDS.kanban.columnTodo);
    const boardCard = todoColumn.getByLabel(taskTitle);
    await expect(boardCard).toBeVisible();
    await expect(
      boardCard.getByText(memberName, { exact: true }),
    ).toBeVisible();
    await expect(
      boardCard.getByTestId(TEST_IDS.tasks.assigneeBotBadge),
    ).toBeVisible();

    // ===== 6) 签发 API Token，截取一次性原文 =====
    await page.goto(`/space/${teamSlug}/settings`);
    await page.getByRole("button", { name: "签发", exact: true }).click();
    const rawToken = (
      await page.getByTestId(TEST_IDS.mcp.rawToken).innerText()
    ).trim();
    expect(rawToken).toMatch(/^odm_[0-9A-Za-z]{43}$/);
    await page.getByTestId(TEST_IDS.mcp.tokenDialogClose).click();
    await expect(page.getByTestId(TEST_IDS.mcp.rawToken)).toBeHidden();

    // ===== 7) MCP initialize =====
    const initResponse = await mcpPost(request, rawToken, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "e2e", version: "1.0.0" },
      },
    });
    expect(initResponse.status()).toBe(200);
    const initBody = (await initResponse.json()) as {
      result?: { serverInfo?: { name?: string; version?: string } };
    };
    expect(initBody.result?.serverInfo?.name).toBe("open-doing-mcp");
    expect(initBody.result?.serverInfo?.version).toBe("0.1.0");

    // ===== 8) whoami：团队与虚拟成员身份 =====
    const identity = (await callTool(request, rawToken, 2, "whoami", {})) as {
      team: { name: string; slug: string };
      virtualMember: { name: string };
    };
    expect(identity.team.name).toBe(teamName);
    expect(identity.virtualMember.name).toBe(memberName);

    // ===== 9) list_tasks（self）：取任务 id =====
    const taskList = (await callTool(request, rawToken, 3, "list_tasks", {
      assignee: "self",
    })) as { id: string; title: string }[];
    const targetTask = taskList.find((task) => task.title === taskTitle);
    expect(targetTask).toBeDefined();
    expect(targetTask?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // ===== 10) update_task_status：agent 写入 =====
    const updated = (await callTool(
      request,
      rawToken,
      4,
      "update_task_status",
      { taskId: targetTask?.id, status: "in_progress" },
    )) as { status: string };
    expect(updated.status).toBe("in_progress");

    // ===== 11) 页面可见：任务进入「进行中」列 =====
    await page.goto(`${projectPath}?view=board`);
    await expect(
      page.getByTestId(TEST_IDS.kanban.columnInProgress).getByLabel(taskTitle),
    ).toBeVisible();

    // ===== 12) 通知铃：虚拟成员署名的 agent 活动通知 =====
    const bell = page.getByTestId(TEST_IDS.shell.notificationBellButton);
    await expect(bell).toHaveAccessibleName(/1 条未读/, { timeout: 30_000 });
    await bell.click();

    const notificationBody = `${memberName} 更新了任务「${taskTitle}」的状态`;
    await expect(page.getByText(notificationBody, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button").filter({ hasText: notificationBody }),
    ).toHaveCount(1);

    // ===== 13) 错误 Token → 401 =====
    const badTokenResponse = await mcpPost(
      request,
      "odm_e2e_invalid_token",
      { jsonrpc: "2.0", id: 5, method: "tools/list", params: {} },
    );
    expect(badTokenResponse.status()).toBe(401);
    expect(await badTokenResponse.json()).toEqual({ error: "unauthorized" });
  });
});

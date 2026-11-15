/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OD_MS } from "@/components/ui/overlay-motion";
import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

const { refreshMock, issueActionMock, revokeActionMock, toastSuccessMock, toastErrorMock } =
  vi.hoisted(() => ({
    refreshMock: vi.fn(),
    issueActionMock: vi.fn(),
    revokeActionMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: refreshMock,
    replace: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock, warning: vi.fn() },
}));

vi.mock("../actions", () => ({
  issueApiTokenAction: issueActionMock,
  revokeApiTokenAction: revokeActionMock,
}));

const { ApiTokenManager } = await import("./ApiTokenManager");

const TEAM_SLUG = "agent-squad";
const RAW_TOKEN = "odm_RAWONLYONCExxxxxxxxxxxxxxxxxxxxxxxxxxxxyyyyyy";

const members = [
  { id: "vm-1", name: "写作助手", accentColor: "#a66b00" },
  { id: "vm-2", name: "绘图助手", accentColor: "#0b6fb8" },
];

type Tokens = Parameters<typeof ApiTokenManager>[0]["tokens"];

const existingTokens: Tokens = [
  { virtualMemberId: "vm-1", tokenPrefix: "odm_AAAA", lastUsedAt: null },
];

/**
 * 仓库 vitest 是 node 环境（无 @testing-library），沿用 VirtualMemberManager 的
 * jsdom + React 官方 act 最小探针写法：真实挂载组件（Radix Portal 挂在
 * document.body 上），fake timers 驱动 overlay 退出保持窗口。
 */
describe("ApiTokenManager", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;
  let clipboardWriteText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function find<T extends Element>(selector: string): T | null {
    return document.body.querySelector<T>(selector);
  }

  function renderManager(tokenList: Tokens = existingTokens): void {
    act(() => {
      root!.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ApiTokenManager
            teamSlug={TEAM_SLUG}
            members={members}
            tokens={tokenList}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  async function click(testId: string): Promise<void> {
    const button = find<HTMLElement>(`[data-testid="${testId}"]`);
    if (!button) throw new Error(`${testId} missing`);

    await act(async () => {
      button.click();
    });
  }

  async function flushAsync(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("列表渲染：已签发成员展示前缀与从未使用，未签发成员展示状态与签发按钮", () => {
    renderManager();

    const issuedRow = find('[data-testid="api-token-row-vm-1"]');
    expect(issuedRow?.textContent).toContain("写作助手");
    expect(issuedRow?.textContent).toContain("odm_AAAA");
    expect(issuedRow?.textContent).toContain(zh.mcp.tokens.neverUsed);
    expect(issuedRow?.textContent).toContain(zh.mcp.tokens.reissue);
    expect(
      find(`[data-testid="revoke-api-token-vm-1"]`),
    ).not.toBeNull();

    const emptyRow = find('[data-testid="api-token-row-vm-2"]');
    expect(emptyRow?.textContent).toContain(zh.mcp.tokens.notIssued);
    expect(emptyRow?.textContent).toContain(zh.mcp.tokens.issue);
    expect(find('[data-testid="revoke-api-token-vm-2"]')).toBeNull();
  });

  it("签发成功：一次性 Dialog 展示原文、端点 URL 与可粘贴配置片段，并刷新列表", async () => {
    issueActionMock.mockResolvedValue({
      ok: true,
      data: { token: RAW_TOKEN, tokenPrefix: "odm_AAAA" },
    });
    renderManager();

    await click("issue-api-token-vm-2");
    await flushAsync();

    expect(issueActionMock).toHaveBeenCalledWith({
      teamSlug: TEAM_SLUG,
      virtualMemberId: "vm-2",
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalledWith(zh.mcp.tokens.issued);

    const raw = find('[data-testid="api-token-raw"]')?.textContent;
    expect(raw).toBe(RAW_TOKEN);

    const snippet = find('[data-testid="api-token-config"]')?.textContent;
    expect(snippet).toContain("mcpServers");
    expect(snippet).toContain(`Bearer ${RAW_TOKEN}`);
    expect(snippet).toContain("/api/mcp");

    expect(find('[data-testid="copy-api-token"]')).not.toBeNull();
  });

  it("复制原文按钮写入剪贴板，toast 只提示已复制、不回显原文", async () => {
    issueActionMock.mockResolvedValue({
      ok: true,
      data: { token: RAW_TOKEN, tokenPrefix: "odm_AAAA" },
    });
    renderManager();

    await click("issue-api-token-vm-2");
    await flushAsync();
    await click("copy-api-token");
    await flushAsync();

    expect(clipboardWriteText).toHaveBeenCalledWith(RAW_TOKEN);
    expect(toastSuccessMock).toHaveBeenCalledWith(zh.mcp.tokens.copied);
    expect(toastSuccessMock).not.toHaveBeenCalledWith(
      expect.stringContaining(RAW_TOKEN),
    );
  });

  it("关闭一次性 Dialog 后原文立即从 DOM 消失，保持窗口结束后弹窗卸载", async () => {
    issueActionMock.mockResolvedValue({
      ok: true,
      data: { token: RAW_TOKEN, tokenPrefix: "odm_AAAA" },
    });
    renderManager();

    await click("issue-api-token-vm-2");
    await flushAsync();
    expect(find('[data-testid="api-token-raw"]')?.textContent).toBe(RAW_TOKEN);

    await click("api-token-dialog-close");
    await flushAsync();

    // 退出保持窗口内弹窗内容仍挂载，但原文已不在状态 / DOM 中。
    expect(find('[data-testid="api-token-raw"]')).toBeNull();
    expect(document.body.textContent).not.toContain(RAW_TOKEN);

    act(() => {
      vi.advanceTimersByTime(OD_MS.modalOut + 50);
    });
    expect(find('[data-slot="dialog-content"]')).toBeNull();
  });

  it("一次性 Dialog 打开时吊销按钮禁用，关闭后恢复可点", async () => {
    issueActionMock.mockResolvedValue({
      ok: true,
      data: { token: RAW_TOKEN, tokenPrefix: "odm_AAAA" },
    });
    renderManager();

    await click("issue-api-token-vm-2");
    await flushAsync();

    const revoke = find<HTMLButtonElement>('[data-testid="revoke-api-token-vm-1"]');
    expect(revoke?.disabled).toBe(true);

    // 不允许在原文弹窗上叠加 ConfirmModal；关闭后立即恢复。
    await click("api-token-dialog-close");
    await flushAsync();

    expect(
      find<HTMLButtonElement>('[data-testid="revoke-api-token-vm-1"]')?.disabled,
    ).toBe(false);

    act(() => {
      vi.advanceTimersByTime(OD_MS.modalOut + 50);
    });
  });

  it("重新签发：已有 Token 的成员按钮为重新签发，签发后 props 刷新展示新前缀", async () => {
    issueActionMock.mockResolvedValue({
      ok: true,
      data: { token: RAW_TOKEN, tokenPrefix: "odm_BBBB" },
    });
    renderManager();

    expect(
      find('[data-testid="issue-api-token-vm-1"]')?.textContent,
    ).toContain(zh.mcp.tokens.reissue);

    await click("issue-api-token-vm-1");
    await flushAsync();

    expect(issueActionMock).toHaveBeenCalledWith({
      teamSlug: TEAM_SLUG,
      virtualMemberId: "vm-1",
    });

    // router.refresh() 后 RSC 带来新的 token 列表：渲染期同步 props。
    renderManager([
      { virtualMemberId: "vm-1", tokenPrefix: "odm_BBBB", lastUsedAt: null },
    ]);

    const row = find('[data-testid="api-token-row-vm-1"]');
    expect(row?.textContent).toContain("odm_BBBB");
    expect(row?.textContent).not.toContain("odm_AAAA");

    act(() => {
      vi.advanceTimersByTime(OD_MS.modalOut + 50);
    });
  });

  it("吊销：ConfirmModal 确认调用 revoke action，仅成功分支关闭并刷新", async () => {
    revokeActionMock.mockResolvedValue({ ok: true, data: null });
    renderManager();

    await click("revoke-api-token-vm-1");
    expect(find('[data-testid="confirm-revoke-api-token"]')).not.toBeNull();

    await click("confirm-revoke-api-token");
    await flushAsync();

    expect(revokeActionMock).toHaveBeenCalledWith({
      teamSlug: TEAM_SLUG,
      virtualMemberId: "vm-1",
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalledWith(zh.mcp.tokens.revoked);

    act(() => {
      vi.advanceTimersByTime(OD_MS.modalOut + 50);
    });
    expect(find('[data-testid="confirm-revoke-api-token"]')).toBeNull();
  });

  it("吊销失败：弹窗保持、不刷新、显示错误 toast", async () => {
    revokeActionMock.mockResolvedValue({
      ok: false,
      errors: { form: zh.mcp.tokens.revokeFailed },
    });
    renderManager();

    await click("revoke-api-token-vm-1");
    await click("confirm-revoke-api-token");
    await flushAsync();

    expect(refreshMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(zh.mcp.tokens.revokeFailed);
    expect(find('[data-testid="confirm-revoke-api-token"]')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(OD_MS.modalOut + 50);
    });
  });

  it("签发失败：form / 字段错误都以 toast 呈现，且不打开一次性弹窗", async () => {
    issueActionMock.mockResolvedValue({
      ok: false,
      errors: { form: "签发被拒绝" },
    });
    renderManager();

    await click("issue-api-token-vm-2");
    await flushAsync();

    expect(toastErrorMock).toHaveBeenCalledWith("签发被拒绝");
    expect(refreshMock).not.toHaveBeenCalled();
    expect(find('[data-testid="api-token-raw"]')).toBeNull();

    vi.clearAllMocks();
    issueActionMock.mockResolvedValue({
      ok: false,
      errors: { virtualMemberId: "虚拟成员不存在" },
    });

    await click("issue-api-token-vm-2");
    await flushAsync();

    expect(toastErrorMock).toHaveBeenCalledWith("虚拟成员不存在");
    expect(find('[data-testid="api-token-raw"]')).toBeNull();
  });
});

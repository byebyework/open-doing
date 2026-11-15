"use client";

import { KeyRoundIcon, Loader2Icon, RotateCwIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Alert } from "@/components/ui/shadcn/alert";
import { Badge } from "@/components/ui/shadcn/badge";
import { Button } from "@/components/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/shadcn/dialog";
import { formatTaskTimestamp } from "@/lib/date-display";

import { issueApiTokenAction, revokeApiTokenAction } from "../actions";

/** 列表行所需的虚拟成员字段（RSC 已过滤为可管理成员）。 */
export interface ApiTokenMember {
  id: string;
  name: string;
  accentColor: string | null;
}

/** 服务端只读 Token 摘要：原文永不进入该结构。 */
export interface ApiTokenSummaryView {
  virtualMemberId: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
}

export interface ApiTokenManagerProps {
  teamSlug: string;
  members: ApiTokenMember[];
  tokens: ApiTokenSummaryView[];
}

/** 一次性弹窗状态：原文只活在该 state 里，关闭即清空。 */
interface IssuedTokenState {
  memberName: string;
  rawToken: string;
  tokenPrefix: string;
}

/**
 * 生成可粘贴的 MCP 客户端配置片段。
 *
 * `mcpServers` 是客户端协议约定，不翻译；Authorization 使用签发原文。
 */
function buildConfigSnippet(endpoint: string, rawToken: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "open-doing": {
          url: endpoint,
          headers: {
            Authorization: `Bearer ${rawToken}`,
          },
        },
      },
    },
    null,
    2,
  );
}

/**
 * MCP 服务的公网端点。
 *
 * 生产环境由独立服务 `apps/mcp` 提供（nginx 路径路由 `/mcp/`），构建时通过
 * `NEXT_PUBLIC_MCP_BASE_URL` 注入完整地址（Next.js 在构建期把该变量内联进
 * 客户端产物）；未配置时回退到 web 同源的 `/mcp/`，供本地 / 反代前环境使用。
 */
function resolveMcpEndpoint(): string {
  const configured = process.env.NEXT_PUBLIC_MCP_BASE_URL?.trim();
  if (configured) return configured;

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/mcp/`;
}

/**
 * 虚拟团队设置页的 API Token 管理（列表 + 签发 / 重签 / 吊销）。
 *
 * - 列表来自 RSC，`router.refresh()` 后按「sync props → state during render」
 *   模式与最新数据对齐；刷新后只展示 `tokenPrefix`，原文不再出现。
 * - 签发成功后弹出一次性 Dialog：原文 + 复制 + MCP 端点 + 可粘贴配置片段；
 *   关闭时清空 state，原文不保留在客户端。
 * - 吊销走 ConfirmModal（不自动关闭，成功分支才关闭）；退出保持窗口内
 *   迟到点击按 `!open || loading` 幂等闸门忽略。
 */
export function ApiTokenManager({
  teamSlug,
  members,
  tokens,
}: ApiTokenManagerProps) {
  const router = useRouter();
  const t = useTranslations("mcp.tokens");
  const tCommon = useTranslations("common");

  // RSC 数据经 router.refresh() 更新：渲染期与最新 props 对齐。
  const [syncedMembers, setSyncedMembers] = useState<ApiTokenMember[]>(members);
  if (members !== syncedMembers) {
    setSyncedMembers(members);
  }

  const [syncedTokens, setSyncedTokens] = useState<ApiTokenSummaryView[]>(tokens);
  if (tokens !== syncedTokens) {
    setSyncedTokens(tokens);
  }

  const [issuingMemberId, setIssuingMemberId] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedTokenState | null>(null);
  const [revokingMember, setRevokingMember] = useState<ApiTokenMember | null>(null);
  const [revokeLoading, setRevokeLoading] = useState(false);

  const tokenByMemberId = new Map(
    syncedTokens.map((token) => [token.virtualMemberId, token]),
  );

  function closeIssued(): void {
    setIssued(null);
  }

  async function issue(member: ApiTokenMember): Promise<void> {
    // 签发请求进行中 / 一次性弹窗尚未关闭时忽略重复点击。
    if (issuingMemberId || issued) return;

    setIssuingMemberId(member.id);

    try {
      const result = await issueApiTokenAction({
        teamSlug,
        virtualMemberId: member.id,
      });

      if (!result.ok) {
        toast.error(
          result.errors.form ??
            Object.values(result.errors)[0] ??
            t("issueFailed"),
        );
        return;
      }

      toast.success(t("issued"));
      setIssued({
        memberName: member.name,
        rawToken: result.data.token,
        tokenPrefix: result.data.tokenPrefix,
      });
      // 列表刷新后只展示前缀；原文只存在于当前弹窗 state。
      router.refresh();
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setIssuingMemberId(null);
    }
  }

  async function confirmRevoke(): Promise<void> {
    if (!revokingMember || revokeLoading) return;

    setRevokeLoading(true);

    try {
      const result = await revokeApiTokenAction({
        teamSlug,
        virtualMemberId: revokingMember.id,
      });

      if (!result.ok) {
        toast.error(result.errors.form ?? t("revokeFailed"));
        return;
      }

      toast.success(t("revoked"));
      router.refresh();
      // ConfirmModal 不自动关闭：仅成功分支关闭，失败保持弹窗。
      setRevokingMember(null);
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setRevokeLoading(false);
    }
  }

  async function copyValue(value: string): Promise<void> {
    if (!navigator.clipboard?.writeText) {
      toast.error(tCommon("copyFailed"));
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      // 不回显被复制的值：原文 / 片段含 Token，避免 toast 二次暴露。
      toast.success(t("copied"));
    } catch {
      toast.error(tCommon("copyFailed"));
    }
  }

  const endpointUrl = resolveMcpEndpoint();
  const configSnippet = issued
    ? buildConfigSnippet(endpointUrl, issued.rawToken)
    : "";

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-[15px] font-bold text-[var(--ink-900)]">{t("title")}</h2>
        <p className="mt-1 text-[13px] text-[var(--ink-400)]">{t("subtitle")}</p>
      </div>

      {syncedMembers.length === 0 ? (
        <div className="rounded-[var(--radius-8)] border border-dashed border-[#eceef0] px-4 py-6 text-center">
          <p className="text-[13px] font-medium text-[var(--ink-900)]">{t("empty")}</p>
          <p className="mt-1 text-[12px] text-[var(--ink-400)]">{t("emptyHint")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {syncedMembers.map((member) => {
            const token = tokenByMemberId.get(member.id);
            const issuing = issuingMemberId === member.id;

            return (
              <li
                key={member.id}
                data-testid={`api-token-row-${member.id}`}
                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-8)] border border-[#eceef0] px-3 py-2.5"
              >
                <span
                  className="grid size-8 flex-none place-items-center rounded-full text-[12px] font-semibold text-white"
                  style={{ backgroundColor: member.accentColor ?? "var(--ink-400)" }}
                  aria-hidden="true"
                >
                  {[...member.name.trim()][0] ?? ""}
                </span>

                <span className="text-[13px] font-medium text-[var(--ink-900)]">
                  {member.name}
                </span>

                {token ? (
                  <>
                    <Badge
                      variant="success"
                      className="rounded-[var(--radius-pill)] px-2 py-0 text-[12px] font-medium leading-5"
                    >
                      {t("statusIssued")}
                    </Badge>
                    <span
                      data-testid={`api-token-prefix-${member.id}`}
                      className="font-mono text-[12px] text-[var(--ink-500)]"
                    >
                      {token.tokenPrefix}…
                    </span>
                    <span
                      data-testid={`api-token-last-used-${member.id}`}
                      className="text-[12px] text-[var(--ink-400)]"
                    >
                      {token.lastUsedAt
                        ? t("lastUsed", { time: formatTaskTimestamp(token.lastUsedAt) })
                        : t("neverUsed")}
                    </span>
                  </>
                ) : (
                  <Badge
                    variant="neutral"
                    className="rounded-[var(--radius-pill)] px-2 py-0 text-[12px] font-medium leading-5"
                  >
                    {t("notIssued")}
                  </Badge>
                )}

                <div className="ml-auto flex flex-none items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid={`issue-api-token-${member.id}`}
                    disabled={issuingMemberId !== null || issued !== null}
                    onClick={() => void issue(member)}
                  >
                    {issuing ? (
                      <Loader2Icon className="animate-spin" aria-hidden="true" />
                    ) : token ? (
                      <RotateCwIcon aria-hidden="true" />
                    ) : (
                      <KeyRoundIcon aria-hidden="true" />
                    )}
                    {token ? t("reissue") : t("issue")}
                  </Button>

                  {token ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`${t("revoke")} ${member.name}`}
                      data-testid={`revoke-api-token-${member.id}`}
                      // 一次性弹窗打开时禁用吊销：避免两层 Radix overlay 叠加，
                      // 也避免吊销正在展示原文的那个 Token。
                      disabled={revokeLoading || issued !== null}
                      onClick={() => setRevokingMember(member)}
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={issued !== null}
        onOpenChange={(next) => {
          if (!next) closeIssued();
        }}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{t("oneTimeTitle")}</DialogTitle>
          </DialogHeader>

          <Alert variant="warning" role="alert" data-testid="api-token-one-time-warning">
            {t("oneTimeWarning")}
          </Alert>

          {issued ? (
            <>
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-semibold text-[var(--ink-900)]">
                  {t("tokenLabel")}
                </span>
                <div className="flex min-w-0 items-center gap-2">
                  <pre
                    data-testid="api-token-raw"
                    className="min-w-0 flex-1 overflow-x-auto rounded-[var(--radius-8)] bg-[var(--surface-subtle)] px-3 py-2 font-mono text-[12px] text-[var(--ink-900)]"
                  >
                    {issued.rawToken}
                  </pre>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="copy-api-token"
                    onClick={() => void copyValue(issued.rawToken)}
                  >
                    {t("copy")}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-semibold text-[var(--ink-900)]">
                  {t("endpointLabel")}
                </span>
                <code
                  data-testid="api-token-endpoint"
                  className="break-all rounded-[var(--radius-8)] bg-[var(--surface-subtle)] px-3 py-2 font-mono text-[12px] text-[var(--ink-700)]"
                >
                  {endpointUrl}
                </code>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-semibold text-[var(--ink-900)]">
                  {t("configLabel")}
                </span>
                <p className="text-[12px] text-[var(--ink-400)]">{t("configHint")}</p>
                <div className="flex min-w-0 items-start gap-2">
                  <pre
                    data-testid="api-token-config"
                    className="min-w-0 flex-1 overflow-x-auto rounded-[var(--radius-8)] bg-[var(--surface-subtle)] px-3 py-2 font-mono text-[12px] text-[var(--ink-900)]"
                  >
                    {configSnippet}
                  </pre>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="copy-api-token-config"
                    onClick={() => void copyValue(configSnippet)}
                  >
                    {t("copy")}
                  </Button>
                </div>
              </div>
            </>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              data-testid="api-token-dialog-close"
              onClick={closeIssued}
            >
              {t("done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={revokingMember !== null}
        title={t("revokeConfirmTitle")}
        content={
          <p>
            {t("revokeConfirmDescription", { name: revokingMember?.name ?? "" })}
          </p>
        }
        confirmText={t("revoke")}
        danger
        loading={revokeLoading}
        okButtonProps={{ "data-testid": "confirm-revoke-api-token" }}
        onConfirm={() => void confirmRevoke()}
        onCancel={() => setRevokingMember(null)}
      />
    </div>
  );
}

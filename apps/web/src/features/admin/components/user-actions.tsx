"use client";

import {
  BanIcon,
  CheckCircle2Icon,
  ShieldCheckIcon,
  ShieldOffIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { CARD_SHELL } from "@/components/ui/card";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/shadcn/button";

import { setUserAdminAction, setUserDisabledAction } from "../actions";

/** 本页支持的四种账号操作。 */
type UserAction = "disable" | "enable" | "grant" | "revoke";

/** 每种操作的弹窗 / 成功文案 key（成功文案带 {name} 参数）。 */
const ACTION_COPY = {
  disable: {
    title: "disableTitle",
    body: "disableBody",
    confirm: "disableConfirm",
    success: "disableSuccess",
    danger: true,
  },
  enable: {
    title: "enableTitle",
    body: "enableBody",
    confirm: "enableConfirm",
    success: "enableSuccess",
    danger: false,
  },
  grant: {
    title: "grantAdminTitle",
    body: "grantAdminBody",
    confirm: "grantAdminConfirm",
    success: "grantSuccess",
    danger: false,
  },
  revoke: {
    title: "revokeAdminTitle",
    body: "revokeAdminBody",
    confirm: "revokeAdminConfirm",
    success: "revokeSuccess",
    danger: true,
  },
} as const;

interface ActionButton {
  action: UserAction;
  label: "grantAdmin" | "revokeAdmin" | "disableAction" | "enableAction";
  testId: string;
  icon: LucideIcon;
}

/**
 * 用户详情页「管理操作」卡（client）。
 *
 * 对照 `admin-user-detail.html`：普通用户显示「授予管理员」(outline) 与
 * 「禁用该用户」(destructive)；已是管理员显示「撤销管理员」；已禁用显示
 * 「解禁该用户」。所有操作经 `ConfirmModal` 二次确认；成功后 sonner toast
 * → `router.refresh()` → 关闭弹窗，失败保持弹窗并 toast 服务端返回的错误
 * （目标用户被删除等）。
 *
 * 当前管理员查看自己时由页面改渲染 `SelfActionsCard`（不挂载本组件），
 * 服务层 selfOperation 校验仍是兜底。
 */
export function UserActionsCard({
  userId,
  name,
  isAdmin,
  isDisabled,
}: {
  userId: string;
  name: string;
  isAdmin: boolean;
  isDisabled: boolean;
}) {
  const t = useTranslations("admin");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [pending, setPending] = useState<UserAction | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleConfirm(): Promise<void> {
    // 弹窗内容在退出保持窗口内仍挂载；按 !pending || loading 防双发。
    if (!pending || loading) return;

    const action = pending;
    setLoading(true);

    try {
      const result =
        action === "disable" || action === "enable"
          ? await setUserDisabledAction(userId, action === "disable")
          : await setUserAdminAction(userId, action === "grant");

      if (!result.ok) {
        toast.error(result.errors.form ?? t("actionFailed"));
        return;
      }

      toast.success(t(ACTION_COPY[action].success, { name }));
      router.refresh();
      setPending(null);
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setLoading(false);
    }
  }

  // 管理员身份切换与启停用状态是两条独立操作，按当前状态各渲染一个按钮。
  const buttons: ActionButton[] = [
    isAdmin
      ? {
          action: "revoke",
          label: "revokeAdmin",
          testId: "user-revoke-admin",
          icon: ShieldOffIcon,
        }
      : {
          action: "grant",
          label: "grantAdmin",
          testId: "user-grant-admin",
          icon: ShieldCheckIcon,
        },
    isDisabled
      ? {
          action: "enable",
          label: "enableAction",
          testId: "user-enable",
          icon: CheckCircle2Icon,
        }
      : {
          action: "disable",
          label: "disableAction",
          testId: "user-disable",
          icon: BanIcon,
        },
  ];

  const copy = pending ? ACTION_COPY[pending] : ACTION_COPY.disable;

  return (
    <>
      <section className={`${CARD_SHELL} px-4 py-4 min-[861px]:px-5`}>
        <h2 className="mb-4 text-[15px] font-bold leading-tight text-[var(--ink-900)]">
          {t("detailActionsTitle")}
        </h2>
        <div className="flex flex-col gap-2">
          {buttons.map(({ action, label, testId, icon: Icon }) => (
            <Button
              key={action}
              type="button"
              variant={action === "disable" ? "destructive" : "outline"}
              className="w-full"
              data-testid={testId}
              onClick={() => setPending(action)}
            >
              <Icon className="h-[15px] w-[15px]" aria-hidden />
              {t(label)}
            </Button>
          ))}
          <p className="mt-2 text-[12.5px] leading-[1.6] text-[var(--muted-foreground)]">
            {t("detailActionsHint")}
          </p>
        </div>
      </section>

      <ConfirmModal
        open={pending !== null}
        title={t(copy.title, { name })}
        content={t(copy.body, { name })}
        confirmText={t(copy.confirm)}
        danger={copy.danger}
        loading={loading}
        okButtonProps={{ "data-testid": "user-action-confirm" }}
        onConfirm={handleConfirm}
        onCancel={() => {
          if (loading) return;

          setPending(null);
        }}
      />
    </>
  );
}

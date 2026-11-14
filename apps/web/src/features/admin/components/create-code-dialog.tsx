"use client";

import { Loader2Icon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/shadcn/alert";
import { Button } from "@/components/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/shadcn/dialog";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";

import { createRegistrationCodeAction } from "../actions";

/** 次数上限的默认值与合法区间（与 Server Action 的守卫一致）。 */
const DEFAULT_MAX_USES = "10";
const MAX_USES_MIN = 1;
const MAX_USES_MAX = 1000;

/**
 * 新增注册码入口（页头主按钮 + 表单弹窗）。
 *
 * 对照 `admin-registration-codes.html` 的「新增注册码」弹窗：单个
 * maxUses 数字输入（默认 10，1–1000），码值由系统生成。提交成功 →
 * sonner toast（带新码）→ `router.refresh()` → 关闭弹窗；失败保持
 * 打开并把字段 / 表单错误留在原位（ConfirmModal 同语义）。
 *
 * 弹窗内容在退出保持窗口（约 200ms）内仍挂载且可交互，故提交处理
 * 必须按 `!open || loading` 幂等闸门防双发；loading 期间取消 / Esc
 * 与关闭钮均被忽略。
 */
export function CreateCodeDialog() {
  const t = useTranslations("admin");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [maxUses, setMaxUses] = useState(DEFAULT_MAX_USES);
  const [loading, setLoading] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // 每次打开都重置（关闭期间内容被卸载，但组件状态常驻）。
  function openDialog(): void {
    setMaxUses(DEFAULT_MAX_USES);
    setFieldError(null);
    setFormError(null);
    setOpen(true);
  }

  function close(): void {
    if (loading) return;
    setOpen(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    // 成功分支会关闭弹窗，但内容在退出保持窗口内仍可交互；期间回车 /
    // 迟到的点击都可能再次提交，这里按 !open || loading 忽略。
    if (!open || loading) return;

    const parsed = Number(maxUses);
    if (
      !Number.isInteger(parsed) ||
      parsed < MAX_USES_MIN ||
      parsed > MAX_USES_MAX
    ) {
      setFieldError(t("adminMaxUsesRange"));
      return;
    }

    setLoading(true);
    setFieldError(null);
    setFormError(null);

    try {
      const result = await createRegistrationCodeAction(parsed);

      if (!result.ok) {
        // 字段错误回填到输入框下方；表单级错误（鉴权 / 未知失败）显示在顶部。
        if (result.errors.maxUses) {
          setFieldError(result.errors.maxUses);
        } else {
          setFormError(result.errors.form ?? t("actionFailed"));
        }
        return;
      }

      toast.success(t("codesCreateSuccess", { code: result.data.code }));
      router.refresh();
      setOpen(false);
    } catch {
      setFormError(tCommon("networkError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        data-testid="create-code-trigger"
        onClick={openDialog}
      >
        <PlusIcon aria-hidden="true" />
        {t("codesCreate")}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{t("codesCreateTitle")}</DialogTitle>
          </DialogHeader>

          {formError ? (
            <Alert variant="destructive" role="alert">
              {formError}
            </Alert>
          ) : null}

          <form onSubmit={onSubmit} noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="create-code-max-uses">
                {t("codesMaxUsesLabel")}
              </Label>
              <Input
                id="create-code-max-uses"
                data-testid="code-max-uses-input"
                type="number"
                min={MAX_USES_MIN}
                max={MAX_USES_MAX}
                value={maxUses}
                onChange={(event) => setMaxUses(event.target.value)}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={
                  fieldError
                    ? "create-code-max-uses-error"
                    : "create-code-max-uses-hint"
                }
                disabled={loading}
                autoFocus
              />
              {fieldError ? (
                <p
                  id="create-code-max-uses-error"
                  data-testid="code-max-uses-error"
                  className="text-[12.5px] text-[var(--error)]"
                >
                  {fieldError}
                </p>
              ) : (
                <p
                  id="create-code-max-uses-hint"
                  className="text-[12.5px] text-[var(--ink-400)]"
                >
                  {t("codesMaxUsesHint")}
                </p>
              )}
            </div>

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                data-testid="create-code-cancel"
                disabled={loading}
                onClick={close}
              >
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                data-testid="create-code-submit"
                disabled={loading}
              >
                {loading ? (
                  <Loader2Icon className="animate-spin" aria-hidden="true" />
                ) : null}
                {t("codesCreateSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

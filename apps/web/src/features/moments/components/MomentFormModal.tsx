"use client";

import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Alert } from "@/components/ui/shadcn/alert";
import { Button } from "@/components/ui/shadcn/button";
import { Checkbox } from "@/components/ui/shadcn/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/shadcn/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/shadcn/select";
import { cn } from "@/lib/utils";
import { todayInShanghai, WEEKDAY_KEYS } from "@/lib/today";

import { createMomentAction, updateMomentAction } from "../actions";
import type { MomentInput, MomentView } from "../service";

/** MomentFormModal 入参。 */
export interface MomentFormModalProps {
  /** 是否显示。 */
  open: boolean;
  /** 开关回调（取消 / 关闭）。 */
  onOpenChange: (open: boolean) => void;
  /** 编辑时的初始视图；缺省即新建。 */
  initial?: MomentView;
  /** 保存成功回调（由调用方关闭弹窗并刷新数据）。 */
  onSaved: (view: MomentView) => void;
}

type Mode = MomentView["mode"];
type Cycle = Exclude<MomentView["cycle"], null>;

/** 受控表单的全部字段（周几 / 每月日 / 每年日各自独立，切换周期不丢值）。 */
interface MomentFormState {
  title: string;
  mode: Mode;
  cycle: Cycle;
  /** 正计时起点 / 倒计时目标日，同时作为每周、每月、每日的锚点日。 */
  anchorDate: string;
  weekday: string;
  monthDay: string;
  /** 每年周期的月日来源（独立控件，避免与非周期日期共用同一 id）。 */
  yearlyDate: string;
  pinned: boolean;
}

/** 按 initial 生成打开时的表单值；新建时默认「周期 · 每月 15 日」（对齐原型）。 */
function formStateFrom(initial?: MomentView): MomentFormState {
  const today = todayInShanghai();

  return {
    title: initial?.title ?? "",
    mode: initial?.mode ?? "periodic",
    cycle: initial?.cycle ?? "monthly",
    anchorDate: initial?.anchorDate ?? today,
    weekday: String(initial?.weekday ?? 5),
    monthDay: String(initial?.dayOfMonth ?? 15),
    yearlyDate: initial?.anchorDate ?? today,
    pinned: initial?.pinned ?? false,
  };
}

/** 模式切换按钮的选中态（原型 `[aria-pressed="true"]`）。 */
const ACTIVE_TOGGLE_CLASS =
  "border-[var(--purple-600)] bg-[var(--primary-bg)] text-[var(--purple-700)] hover:bg-[var(--primary-bg)]";

/**
 * 新建 / 编辑「时刻」弹窗（原型分节 B）。
 *
 * 名称 → 计时模式三档 → 模式子面板（正计时=起始日期、倒计时=目标日期、
 * 周期计时=每日/每周/每月/每年 + 对应输入）→ footer。新建态主按钮为
 * 「保存并置顶」（payload `pinned: true`，无复选框）；编辑态显示置顶复选框、
 * 主按钮为「保存」。
 *
 * 提交前把表单归一化为 `MomentInput`：非周期模式 `cycle/weekday/dayOfMonth`
 * 一律 null；周期按 cycle 只保留对应子字段（每年周期的 `anchorDate` 取 yearly
 * 日期控件）。字段错误回填到名称 / 日期控件，form 级错误展示在顶部。
 * `!open || submitting` 是退出保持窗口期间的幂等闸门。
 */
export function MomentFormModal({
  open,
  onOpenChange,
  initial,
  onSaved,
}: MomentFormModalProps) {
  const t = useTranslations("moments");
  const tDate = useTranslations("date");
  const tCommon = useTranslations("common");

  const [form, setForm] = useState<MomentFormState>(() => formStateFrom(initial));
  const [prevOpen, setPrevOpen] = useState(open);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // 每次打开重置为 initial / 默认值（关闭期间内容仍在退出保持窗口内挂载）。
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setForm(formStateFrom(initial));
      setErrors({});
    }
  }

  function patchForm(patch: Partial<MomentFormState>): void {
    setForm((previous) => ({ ...previous, ...patch }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    // 退出保持窗口内内容仍挂载：open 已翻 false / 仍在提交时忽略迟到提交。
    if (!open || submitting) return;

    setSubmitting(true);
    setErrors({});

    const periodic = form.mode === "periodic";
    const input: MomentInput = {
      title: form.title.trim(),
      mode: form.mode,
      anchorDate:
        periodic && form.cycle === "yearly"
          ? form.yearlyDate.trim()
          : form.anchorDate.trim(),
      cycle: periodic ? form.cycle : null,
      weekday: periodic && form.cycle === "weekly" ? Number(form.weekday) : null,
      dayOfMonth:
        periodic && form.cycle === "monthly" ? Number(form.monthDay) : null,
      // 新建默认置顶（主按钮语义「保存并置顶」）；编辑尊重复选框。
      pinned: initial ? form.pinned : true,
    };

    try {
      const result = initial
        ? await updateMomentAction(initial.id, input)
        : await createMomentAction(input);

      if (!result.ok) {
        setErrors(result.errors);
        return;
      }

      onSaved(result.data);
    } catch {
      setErrors({ form: tCommon("networkError") });
    } finally {
      setSubmitting(false);
    }
  }

  const dateErrorFor = (field: "shared" | "yearly" | "other") => {
    if (!errors.date) return null;

    if (
      (field === "shared" && form.mode !== "periodic") ||
      (field === "yearly" && form.mode === "periodic" && form.cycle === "yearly")
    ) {
      return errors.date;
    }

    // 每周 / 每月 / 每日的锚点日由默认值兜底，正常路径不会触发；
    // 真出错时展示在面板底部，避免错误被吞掉。
    if (
      field === "other" &&
      form.mode === "periodic" &&
      form.cycle !== "yearly"
    ) {
      return errors.date;
    }

    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>
            {initial ? t("form.editTitle") : t("form.createTitle")}
          </DialogTitle>
        </DialogHeader>

        {errors.form ? (
          <Alert variant="destructive" role="alert">
            {errors.form}
          </Alert>
        ) : null}

        <form onSubmit={handleSubmit} noValidate>
          <div className="mb-4 flex flex-col gap-2">
            <Label htmlFor="moment-form-title">{t("form.titleLabel")}</Label>
            <Input
              id="moment-form-title"
              data-testid="moment-form-title"
              type="text"
              placeholder={t("form.titlePlaceholder")}
              maxLength={50}
              autoFocus
              value={form.title}
              disabled={submitting}
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={
                errors.title ? "moment-form-title-error" : undefined
              }
              onChange={(event) => patchForm({ title: event.target.value })}
            />
            {errors.title ? (
              <p
                id="moment-form-title-error"
                className="text-[12.5px] text-[var(--error)]"
              >
                {errors.title}
              </p>
            ) : null}
          </div>

          <div className="mb-4">
            <Label id="moment-form-mode-label" className="mb-2 block">
              {t("form.modeLabel")}
            </Label>
            <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby="moment-form-mode-label">
              {(
                [
                  ["count_up", "moment-form-mode-up", "form.modeUp"],
                  ["countdown", "moment-form-mode-down", "form.modeDown"],
                  ["periodic", "moment-form-mode-periodic", "form.modePeriodic"],
                ] as const
              ).map(([mode, testId, labelKey]) => (
                <Button
                  key={mode}
                  type="button"
                  variant="outline"
                  data-testid={testId}
                  aria-pressed={form.mode === mode}
                  disabled={submitting}
                  className={cn(
                    "h-10 w-full",
                    form.mode === mode ? ACTIVE_TOGGLE_CLASS : undefined,
                  )}
                  onClick={() => patchForm({ mode })}
                >
                  {t(labelKey)}
                </Button>
              ))}
            </div>
          </div>

          {form.mode === "count_up" ? (
            <div className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-subtle)] p-4">
              <Label htmlFor="moment-form-date" className="mb-3 block">
                {t("form.upPanelLabel")}
              </Label>
              <DatePicker
                id="moment-form-date"
                testid="moment-form-date"
                value={form.anchorDate}
                disabled={submitting}
                invalid={dateErrorFor("shared") ? true : undefined}
                describedby={
                  dateErrorFor("shared") ? "moment-form-date-error" : undefined
                }
                onChange={(value) => patchForm({ anchorDate: value })}
              />
              {dateErrorFor("shared") ? (
                <p
                  id="moment-form-date-error"
                  className="mt-2 text-[12.5px] text-[var(--error)]"
                >
                  {dateErrorFor("shared")}
                </p>
              ) : null}
              <p className="mt-2 text-[11.5px] text-[var(--ink-400)]">
                {t("form.upHint")}
              </p>
            </div>
          ) : null}

          {form.mode === "countdown" ? (
            <div className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-subtle)] p-4">
              <Label htmlFor="moment-form-date" className="mb-3 block">
                {t("form.downPanelLabel")}
              </Label>
              <DatePicker
                id="moment-form-date"
                testid="moment-form-date"
                value={form.anchorDate}
                disabled={submitting}
                invalid={dateErrorFor("shared") ? true : undefined}
                describedby={
                  dateErrorFor("shared") ? "moment-form-date-error" : undefined
                }
                onChange={(value) => patchForm({ anchorDate: value })}
              />
              {dateErrorFor("shared") ? (
                <p
                  id="moment-form-date-error"
                  className="mt-2 text-[12.5px] text-[var(--error)]"
                >
                  {dateErrorFor("shared")}
                </p>
              ) : null}
              <p className="mt-2 text-[11.5px] text-[var(--ink-400)]">
                {t("form.downHint")}
              </p>
            </div>
          ) : null}

          {form.mode === "periodic" ? (
            <div className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-subtle)] p-4">
              <Label className="mb-3 block">{t("form.cycleLabel")}</Label>
              <div
                className="flex items-center gap-2"
                role="group"
                aria-label={t("form.cycleLabel")}
              >
                {(
                  [
                    ["daily", "moment-form-cycle-daily", "form.cycleDaily"],
                    ["weekly", "moment-form-cycle-weekly", "form.cycleWeekly"],
                    ["monthly", "moment-form-cycle-monthly", "form.cycleMonthly"],
                    ["yearly", "moment-form-cycle-yearly", "form.cycleYearly"],
                  ] as const
                ).map(([cycle, testId, labelKey]) => (
                  <Button
                    key={cycle}
                    type="button"
                    variant="ghost"
                    data-testid={testId}
                    aria-pressed={form.cycle === cycle}
                    disabled={submitting}
                    className={cn(
                      "h-[34px] flex-1 border text-[13px] font-semibold",
                      form.cycle === cycle
                        ? "border-[var(--purple-600)] bg-white text-[var(--purple-700)] hover:bg-white"
                        : "border-transparent text-[var(--ink-500)]",
                    )}
                    onClick={() => patchForm({ cycle })}
                  >
                    {t(labelKey)}
                  </Button>
                ))}
              </div>

              {form.cycle === "daily" ? (
                <p className="mt-4 text-[13px] text-[var(--ink-500)]">
                  {t("form.dailyHint")}
                </p>
              ) : null}

              {form.cycle === "weekly" ? (
                <div className="mt-4 flex items-center gap-2">
                  <Label id="moment-form-weekday-label">
                    {t("form.cycleWeekly")}
                  </Label>
                  <Select
                    value={form.weekday}
                    onValueChange={(value) => patchForm({ weekday: value })}
                    disabled={submitting}
                  >
                    <SelectTrigger
                      data-testid="moment-form-weekday"
                      className="w-[120px]"
                      aria-labelledby="moment-form-weekday-label"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAY_KEYS.map((key, index) => (
                        <SelectItem key={key} value={String(index)}>
                          {tDate(key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {form.cycle === "monthly" ? (
                <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-[var(--ink-500)]">
                  <Label htmlFor="moment-form-monthday">
                    {t("form.cycleMonthly")}
                  </Label>
                  <Input
                    id="moment-form-monthday"
                    data-testid="moment-form-monthday"
                    type="number"
                    min={1}
                    max={31}
                    className="w-[90px] text-center"
                    value={form.monthDay}
                    disabled={submitting}
                    onChange={(event) =>
                      patchForm({ monthDay: event.target.value })
                    }
                  />
                  <span>{t("form.monthlyNote")}</span>
                </div>
              ) : null}

              {form.cycle === "yearly" ? (
                <div className="mt-4">
                  <Label htmlFor="moment-form-yearly-date" className="mb-2 block">
                    {t("form.cycleYearly")}
                  </Label>
                  <DatePicker
                    id="moment-form-yearly-date"
                    testid="moment-form-yearly-date"
                    value={form.yearlyDate}
                    disabled={submitting}
                    invalid={dateErrorFor("yearly") ? true : undefined}
                    describedby={
                      dateErrorFor("yearly")
                        ? "moment-form-yearly-date-error"
                        : undefined
                    }
                    onChange={(value) => patchForm({ yearlyDate: value })}
                  />
                  {dateErrorFor("yearly") ? (
                    <p
                      id="moment-form-yearly-date-error"
                      className="mt-2 text-[12.5px] text-[var(--error)]"
                    >
                      {dateErrorFor("yearly")}
                    </p>
                  ) : null}
                  <p className="mt-2 text-[11.5px] text-[var(--ink-400)]">
                    {t("form.yearlyHint")}
                  </p>
                </div>
              ) : null}

              {dateErrorFor("other") ? (
                <p className="mt-2 text-[12.5px] text-[var(--error)]">
                  {dateErrorFor("other")}
                </p>
              ) : null}

              <p className="mt-3 text-[11.5px] text-[var(--ink-400)]">
                {t("form.occurrenceHint")}
              </p>
            </div>
          ) : null}

          {initial ? (
            <div className="mb-4 mt-4 flex items-center gap-2">
              <Checkbox
                id="moment-form-pinned"
                data-testid="moment-form-pinned"
                checked={form.pinned}
                disabled={submitting}
                aria-labelledby="moment-form-pinned-label"
                onCheckedChange={(checked) =>
                  patchForm({ pinned: checked === true })
                }
              />
              <Label id="moment-form-pinned-label" htmlFor="moment-form-pinned">
                {t("form.pinnedLabel")}
              </Label>
            </div>
          ) : null}

          <DialogFooter className="mt-5">
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="submit"
              variant="gradient"
              data-testid="moment-form-submit"
              disabled={submitting}
            >
              {submitting ? (
                <Loader2Icon className="animate-spin" aria-hidden="true" />
              ) : null}
              {initial ? t("form.save") : t("form.saveAndPin")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

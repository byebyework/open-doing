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
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/shadcn/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/shadcn/tabs";

import { createDayAction, updateDayAction } from "../actions";
import type { ImportantDayInput, ImportantDayView } from "../service";

/** DayFormModal 入参。 */
export interface DayFormModalProps {
  /** 是否显示。 */
  open: boolean;
  /** 开关回调（取消 / 关闭）。 */
  onOpenChange: (open: boolean) => void;
  /** 编辑时的初始视图；缺省即新建。 */
  initial?: ImportantDayView;
  /** 保存成功回调（由调用方关闭弹窗并刷新数据）。 */
  onSaved: (view: ImportantDayView) => void;
}

/** 表单字段错误（只保留有输入控件的字段 + form 级）。 */
interface FormErrors {
  title?: string;
  date?: string;
  form?: string;
}

/** 受控表单的全部字段。 */
interface DayFormState {
  title: string;
  isLunar: boolean;
  solarDate: string;
  lunarMonth: string;
  lunarDay: string;
  solarRepeat: boolean;
  pinned: boolean;
}

/** 农历月 / 日下拉的候选文案：月 1–12、日 1–30。 */
const LUNAR_MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
const LUNAR_DAYS = Array.from({ length: 30 }, (_, index) => index + 1);

/** 按 initial 生成打开时的表单值（新建时给默认值）。 */
function formStateFrom(initial?: ImportantDayView): DayFormState {
  return {
    title: initial?.title ?? "",
    isLunar: initial?.isLunar ?? false,
    solarDate: initial?.anchorDate ?? "",
    lunarMonth: String(initial?.lunarMonth ?? 1),
    lunarDay: String(initial?.lunarDay ?? 1),
    solarRepeat: initial?.repeat === "yearly",
    pinned: initial?.pinned ?? false,
  };
}

/**
 * 新建 / 编辑「重要日子」弹窗。
 *
 * 字段与 spec 一致：名称、公历 / 农历类型切换、公历日期（对齐
 * `NewTaskModal` 的 `Input type="date"` 控件）、农历月 + 日下拉、
 * 每年重复（农历锁定开启）、置顶。
 *
 * `initial` 只在打开时回填（关闭期间内容在退出保持窗口内仍挂载），
 * 因此按「渲染期同步 props → state」模式在 open 翻 true 时重置表单，
 * 不引入 effect 级联渲染。提交后用 action 返回的 `errors.<field>` 回填到
 * 对应控件；form 级错误展示在顶部。成功分支调用 `onSaved` 由调用方关闭
 * 弹窗。`!open || submitting` 是 exit-hold 期间的幂等闸门，避免弹窗已
 * 关闭后迟到提交导致重复写入。
 */
export function DayFormModal({
  open,
  onOpenChange,
  initial,
  onSaved,
}: DayFormModalProps) {
  const t = useTranslations("days");
  const tCommon = useTranslations("common");

  const [form, setForm] = useState<DayFormState>(() => formStateFrom(initial));
  const [prevOpen, setPrevOpen] = useState(open);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  // 每次打开重置为 initial / 默认值（关闭期间内容仍挂载，状态常驻）。
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setForm(formStateFrom(initial));
      setErrors({});
    }
  }

  function patchForm(patch: Partial<DayFormState>): void {
    setForm((previous) => ({ ...previous, ...patch }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    // 退出保持窗口内内容仍挂载：open 已翻 false / 仍在提交时忽略迟到提交。
    if (!open || submitting) return;

    setSubmitting(true);
    setErrors({});

    const input: ImportantDayInput = form.isLunar
      ? {
          title: form.title.trim(),
          date: null,
          isLunar: true,
          lunarMonth: Number(form.lunarMonth),
          lunarDay: Number(form.lunarDay),
          repeat: "yearly",
          pinned: form.pinned,
        }
      : {
          title: form.title.trim(),
          date: form.solarDate.trim() ? form.solarDate : null,
          isLunar: false,
          lunarMonth: null,
          lunarDay: null,
          repeat: form.solarRepeat ? "yearly" : "none",
          pinned: form.pinned,
        };

    try {
      const result = initial
        ? await updateDayAction(initial.id, input)
        : await createDayAction(input);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
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
            <Label htmlFor="day-form-title">{t("form.titleLabel")}</Label>
            <Input
              id="day-form-title"
              data-testid="day-form-title"
              type="text"
              placeholder={t("form.titlePlaceholder")}
              maxLength={50}
              autoFocus
              value={form.title}
              disabled={submitting}
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? "day-form-title-error" : undefined}
              onChange={(event) => patchForm({ title: event.target.value })}
            />
            {errors.title ? (
              <p
                id="day-form-title-error"
                className="text-[12.5px] text-[var(--error)]"
              >
                {errors.title}
              </p>
            ) : null}
          </div>

          <div className="mb-4">
            <Tabs
              value={form.isLunar ? "lunar" : "solar"}
              onValueChange={(value) =>
                patchForm({ isLunar: value === "lunar" })
              }
            >
              <TabsList className="w-full">
                <TabsTrigger
                  value="solar"
                  data-testid="day-form-type-solar"
                  disabled={submitting}
                >
                  {t("form.typeSolar")}
                </TabsTrigger>
                <TabsTrigger
                  value="lunar"
                  data-testid="day-form-type-lunar"
                  disabled={submitting}
                >
                  {t("form.typeLunar")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {form.isLunar ? (
            <div className="mb-4 grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label id="day-form-month-label">
                  {t("form.lunarMonthLabel")}
                </Label>
                <Select
                  value={form.lunarMonth}
                  onValueChange={(value) => patchForm({ lunarMonth: value })}
                  disabled={submitting}
                >
                  <SelectTrigger
                    data-testid="day-form-month"
                    className="w-full"
                    aria-labelledby="day-form-month-label"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LUNAR_MONTHS.map((month) => (
                      <SelectItem key={month} value={String(month)}>
                        {month}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label id="day-form-day-label">
                  {t("form.lunarDayLabel")}
                </Label>
                <Select
                  value={form.lunarDay}
                  onValueChange={(value) => patchForm({ lunarDay: value })}
                  disabled={submitting}
                >
                  <SelectTrigger
                    data-testid="day-form-day"
                    className="w-full"
                    aria-labelledby="day-form-day-label"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LUNAR_DAYS.map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        {day}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="mb-4 flex flex-col gap-2">
              <Label htmlFor="day-form-date">{t("form.dateLabel")}</Label>
              <Input
                id="day-form-date"
                data-testid="day-form-date"
                type="date"
                value={form.solarDate}
                disabled={submitting}
                aria-invalid={errors.date ? true : undefined}
                aria-describedby={errors.date ? "day-form-date-error" : undefined}
                onChange={(event) => patchForm({ solarDate: event.target.value })}
              />
              {errors.date ? (
                <p
                  id="day-form-date-error"
                  className="text-[12.5px] text-[var(--error)]"
                >
                  {errors.date}
                </p>
              ) : null}
            </div>
          )}

          <div className="mb-4 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Checkbox
                id="day-form-repeat"
                data-testid="day-form-repeat"
                checked={form.isLunar ? true : form.solarRepeat}
                disabled={form.isLunar || submitting}
                aria-labelledby="day-form-repeat-label"
                onCheckedChange={(checked) =>
                  patchForm({ solarRepeat: checked === true })
                }
              />
              <Label id="day-form-repeat-label" htmlFor="day-form-repeat">
                {t("form.repeatLabel")}
              </Label>
            </div>
            {form.isLunar ? (
              <p className="text-[12px] text-[var(--ink-400)]">
                {t("form.repeatLockedHint")}
              </p>
            ) : null}
          </div>

          <div className="mb-4 flex items-center gap-2">
            <Checkbox
              id="day-form-pinned"
              data-testid="day-form-pinned"
              checked={form.pinned}
              disabled={submitting}
              aria-labelledby="day-form-pinned-label"
              onCheckedChange={(checked) =>
                patchForm({ pinned: checked === true })
              }
            />
            <Label id="day-form-pinned-label" htmlFor="day-form-pinned">
              {t("form.pinnedLabel")}
            </Label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              {tCommon("cancel")}
            </Button>
            <Button type="submit" data-testid="day-form-submit" disabled={submitting}>
              {submitting ? (
                <Loader2Icon className="animate-spin" aria-hidden="true" />
              ) : null}
              {t("form.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

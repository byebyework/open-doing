"use client";

import { FlagIcon, Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import { MILESTONE_DESCRIPTION_MAX_LENGTH, MILESTONE_NAME_MAX_LENGTH } from "../constants";

/** 里程碑编辑卡片提交值（时间节点为空串时不可提交）。 */
export interface MilestoneDraftInput {
  name: string;
  description?: string;
  dueDate: string;
}

export interface ProjectMilestoneEditorProps {
  /** 添加回调：成功后编辑器自行清空输入。 */
  onSubmit: (input: MilestoneDraftInput) => void | Promise<void>;
  /** 收起编辑卡（传入才渲染取消按钮；创建表单内不收起故不传）。 */
  onCancel?: () => void;
  submitting?: boolean;
  /** testid 前缀（如 "team-project" → "team-project-milestone-name-input"）。 */
  testIdPrefix?: string;
}

/**
 * Linear「Create milestone」式里程碑编辑卡：名称 + 描述 + 时间节点 + 添加。
 *
 * 名称与时间节点为空时「添加」禁用（客户端必填闸）；描述可选。
 * 服务层校验（field "milestones"）失败时错误落在表单级（调用方映射）。
 */
export function ProjectMilestoneEditor({
  onSubmit,
  onCancel,
  submitting = false,
  testIdPrefix = "project-milestone",
}: ProjectMilestoneEditorProps) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");

  const canAdd = name.trim().length > 0 && dueDate.length > 0 && !submitting;

  const handleAdd = () => {
    if (!canAdd) return;
    void onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      dueDate,
    });
    setName("");
    setDescription("");
    setDueDate("");
  };

  return (
    /* 内联式编辑器（对照 Linear Create milestone）：无边框输入 + 小号日期
     * pill + 小号按钮，弱化卡片感；不再重复「里程碑」标题（外层行已有）。 */
    <div className="mt-2 flex flex-col gap-1 rounded-[var(--radius-lg)] bg-[var(--color-surface-inset)] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <FlagIcon className="size-3.5 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
        <Input
          id={`${testIdPrefix}-milestone-name-input`}
          type="text"
          data-testid={`${testIdPrefix}-milestone-name-input`}
          placeholder={t("milestoneNamePlaceholder")}
          maxLength={MILESTONE_NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={submitting}
          className="h-auto border-none bg-transparent px-0 text-[14px] font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <Input
          id={`${testIdPrefix}-milestone-due-date`}
          type="date"
          data-testid={`${testIdPrefix}-milestone-due-date`}
          aria-label={t("milestoneDueDateLabel")}
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          disabled={submitting}
          className="h-7 w-[150px] shrink-0 rounded-full border-[var(--border)] bg-[var(--card)] px-3 text-[12.5px] tabular-nums"
        />
      </div>
      <Input
        type="text"
        data-testid={`${testIdPrefix}-milestone-description-input`}
        placeholder={t("milestoneDescriptionPlaceholder")}
        maxLength={MILESTONE_DESCRIPTION_MAX_LENGTH}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        disabled={submitting}
        className="h-auto border-none bg-transparent px-0 pl-6 text-[13px] text-[var(--color-text-secondary)] shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="mt-1.5 flex justify-end gap-2">
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={submitting}
            onClick={onCancel}
          >
            {tCommon("cancel")}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          disabled={!canAdd}
          data-testid={`${testIdPrefix}-milestone-add-button`}
          onClick={handleAdd}
        >
          {submitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          {t("milestoneAdd")}
        </Button>
      </div>
    </div>
  );
}

"use client";

import type { Subtask } from "@open-doing/types";
import { Button, Checkbox, Input } from "antd";
import { useState } from "react";

/** 子任务列表入参（`onToggle` / `onAdd` / `onRemove` 缺省时对应 UI 只读或隐藏）。 */
export interface SubtaskListProps {
  /** 子任务列表（保持调用方给定顺序）。 */
  subtasks: Subtask[];
  /** 勾选 / 取消勾选子任务；缺省时复选框只读（团队只读态）。 */
  onToggle?: (subtaskId: string, completed: boolean) => Promise<void>;
  /** 新增子任务；缺省时隐藏底部输入行。 */
  onAdd?: (title: string) => Promise<void>;
  /** 删除子任务；缺省时隐藏每项的删除按钮。 */
  onRemove?: (subtaskId: string) => Promise<void>;
}

/**
 * 子任务列表（纯展示 + 本地交互态）。
 *
 * 不内置错误提示：异步回调由调用方负责提示失败原因，本组件只维护
 * 勾选 / 删除 / 添加过程中的禁用态，避免重复提交。
 */
export function SubtaskList({
  subtasks,
  onToggle,
  onAdd,
  onRemove,
}: SubtaskListProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  async function handleToggle(subtask: Subtask, completed: boolean) {
    if (!onToggle || pendingId) return;

    setPendingId(subtask.id);
    try {
      await onToggle(subtask.id, completed);
    } catch {
      // 错误提示由调用方负责。
    } finally {
      setPendingId(null);
    }
  }

  async function handleRemove(subtaskId: string) {
    if (!onRemove || pendingId) return;

    setPendingId(subtaskId);
    try {
      await onRemove(subtaskId);
    } catch {
      // 错误提示由调用方负责。
    } finally {
      setPendingId(null);
    }
  }

  async function handleAdd() {
    const title = draft.trim();
    if (!onAdd || !title || adding) return;

    setAdding(true);
    try {
      await onAdd(title);
      setDraft("");
    } catch {
      // 错误提示由调用方负责。
    } finally {
      setAdding(false);
    }
  }

  return (
    <div>
      {subtasks.length === 0 ? (
        <p className="py-2 text-[13px] text-[#9aa0a6]">暂无子任务</p>
      ) : (
        <div className="flex flex-col">
          {subtasks.map((subtask) => (
            <div
              key={subtask.id}
              className="group flex min-h-9 items-center gap-2 rounded-lg px-1 hover:bg-[#f7f8fa]"
            >
              <Checkbox
                checked={subtask.completed}
                disabled={!onToggle || pendingId === subtask.id}
                onChange={(event) => {
                  if (!onToggle) return;
                  void handleToggle(subtask, event.target.checked);
                }}
              >
                <span
                  className={
                    subtask.completed
                      ? "text-[#9aa0a6] line-through"
                      : "text-[#0e1318]"
                  }
                >
                  {subtask.title}
                </span>
              </Checkbox>

              {onRemove ? (
                <Button
                  type="text"
                  size="small"
                  danger
                  className="ml-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  loading={pendingId === subtask.id}
                  onClick={() => {
                    void handleRemove(subtask.id);
                  }}
                >
                  删除
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {onAdd ? (
        <div className="mt-2 flex items-center gap-2">
          <Input
            value={draft}
            placeholder="＋ 添加子任务"
            aria-label="新子任务的标题"
            maxLength={200}
            disabled={adding}
            onChange={(event) => setDraft(event.target.value)}
            onPressEnter={() => {
              void handleAdd();
            }}
          />
          <Button
            onClick={() => {
              void handleAdd();
            }}
            loading={adding}
            disabled={!draft.trim()}
          >
            添加
          </Button>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { Button } from "antd";
import { useState, type ReactNode } from "react";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { DueText } from "@/components/ui/DueText";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusTag } from "@/components/ui/StatusTag";
import { UserAvatar } from "@/components/ui/UserAvatar";

/** demo 用的固定「今天」，保证逾期/临期判定与截图可复现。 */
const DEMO_TODAY = "2026-10-22";

/** 演示卡片容器：标题 + 说明 + 内容。 */
function DemoCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-[#e1e3e6] bg-white p-5 shadow-[0_1px_3px_rgba(14,19,24,0.04)]">
      <h2 className="text-[15px] font-semibold text-[#0e1318]">{title}</h2>
      <p className="mt-1 text-[12.5px] text-[#9aa0a6]">{hint}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * 「我的任务」占位页（M0）。
 *
 * 仅用于展示外壳与 6 个共享基础组件的最小可用状态；
 * D-1 会用真实任务页整体替换本文件。
 */
export default function MyTasksPlaceholderPage() {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="mx-auto w-full max-w-[1080px]">
      <header>
        <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[#0e1318]">
          我的任务
        </h1>
        <p className="mt-1 text-[14px] text-[#5f6368]">
          M0 占位页：应用外壳与共享基础组件演示，后续由任务页整体替换。
        </p>
      </header>

      <div className="mt-6 grid min-w-0 grid-cols-1 gap-4 min-[861px]:grid-cols-2">
        <DemoCard title="UserAvatar" hint="用户名首字 + 哈希取点缀色">
          <div className="flex flex-wrap items-center gap-3">
            <UserAvatar username="林夏" />
            <UserAvatar username="何川" size={40} />
            <UserAvatar username="苏晓" />
            <UserAvatar username="Quinn" size={40} />
            <UserAvatar username="Alex" />
          </div>
        </DemoCard>

        <DemoCard title="StatusTag" hint="未开始 / 进行中 / 已完成">
          <div className="flex flex-wrap items-center gap-2">
            <StatusTag status="todo" />
            <StatusTag status="in_progress" />
            <StatusTag status="done" />
          </div>
        </DemoCard>

        <DemoCard title="ProgressBar" hint="入参 0 ~ 1，内部换算百分比">
          <div className="flex flex-col gap-4">
            <div>
              <div className="mb-1.5 text-[12px] text-[#5f6368]">0%</div>
              <ProgressBar value={0} />
            </div>
            <div>
              <div className="mb-1.5 text-[12px] text-[#5f6368]">35%</div>
              <ProgressBar value={0.35} />
            </div>
            <div>
              <div className="mb-1.5 text-[12px] text-[#5f6368]">100%</div>
              <ProgressBar value={1} />
            </div>
          </div>
        </DemoCard>

        <DemoCard title="DueText" hint="逾期红 / 临期黄 / 普通灰">
          <div className="flex flex-col gap-2 text-[13px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#5f6368]">逾期任务</span>
              <DueText
                dueDate="2026-10-19"
                status="in_progress"
                today={DEMO_TODAY}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#5f6368]">今天到期</span>
              <DueText
                dueDate="2026-10-22"
                status="todo"
                today={DEMO_TODAY}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#5f6368]">明天到期</span>
              <DueText
                dueDate="2026-10-23"
                status="in_progress"
                today={DEMO_TODAY}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#5f6368]">普通日期</span>
              <DueText
                dueDate="2026-10-30"
                status="todo"
                today={DEMO_TODAY}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#5f6368]">已完成</span>
              <DueText
                dueDate="2026-10-18"
                status="done"
                today={DEMO_TODAY}
              />
            </div>
          </div>
        </DemoCard>

        <DemoCard title="EmptyState" hint="标题 + 说明 + 可选操作">
          <div className="rounded-lg border border-dashed border-[#e1e3e6]">
            <EmptyState
              title="暂无任务"
              description="创建第一个任务，开始跟踪你的进展。"
              action={<Button type="primary">新建任务</Button>}
            />
          </div>
        </DemoCard>

        <DemoCard title="ConfirmModal" hint="二次确认、危险样式与加载态">
          <Button danger onClick={() => setConfirmOpen(true)}>
            删除任务（打开确认框）
          </Button>
          <ConfirmModal
            open={confirmOpen}
            title="删除任务"
            content="删除后不可恢复，确定删除「示例任务」吗？"
            confirmText="删除"
            danger
            onConfirm={() => setConfirmOpen(false)}
            onCancel={() => setConfirmOpen(false)}
          />
        </DemoCard>
      </div>
    </div>
  );
}

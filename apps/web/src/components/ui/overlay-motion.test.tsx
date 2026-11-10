/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OD_EASE,
  OD_MS,
  modalVariants,
  overlayVariants,
  popVariants,
  sheetVariants,
  useHeldOpen,
} from "./overlay-motion";

/**
 * 本仓库 vitest 是 node 环境（无 testing-library），这里用 jsdom +
 * React 官方 act 手搭一个最小 hook 探针：渲染 Probe 组件、读返回值、
 * 从外部改 open。计时行为用 vi.useFakeTimers 驱动。
 */
function createProbe(initialOpen: boolean, exitMs: number) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let value: boolean | undefined;
  let applyOpen: (open: boolean) => void = () => {};

  function Probe(): null {
    const [open, set] = useState(initialOpen);
    applyOpen = set;
    value = useHeldOpen(open, exitMs);
    return null;
  }

  act(() => {
    root.render(<Probe />);
  });

  return {
    get value() {
      return value;
    },
    setOpen(open: boolean): void {
      act(() => {
        applyOpen(open);
      });
    },
    advance(ms: number): void {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    },
    unmount(): void {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("useHeldOpen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("初始 open 为 true 时立即返回 true", () => {
    const probe = createProbe(true, 200);
    expect(probe.value).toBe(true);
    probe.unmount();
  });

  it("初始 open 为 false 时立即返回 false（不等待）", () => {
    const probe = createProbe(false, 200);
    expect(probe.value).toBe(false);
    probe.unmount();
  });

  it("open 翻 false 后 exitMs 内保持 true（100ms < 200ms）", () => {
    const probe = createProbe(true, 200);
    probe.setOpen(false);
    probe.advance(100);
    expect(probe.value).toBe(true);
    probe.unmount();
  });

  it("advance exitMs 后落回 false", () => {
    const probe = createProbe(true, 200);
    probe.setOpen(false);
    probe.advance(200);
    expect(probe.value).toBe(false);
    probe.unmount();
  });

  it("保持窗口内 open 重新为 true 立即恢复 true，再次关闭后重新计时", () => {
    const probe = createProbe(true, 200);
    probe.setOpen(false);
    probe.advance(100);
    expect(probe.value).toBe(true);

    probe.setOpen(true);
    expect(probe.value).toBe(true);

    probe.setOpen(false);
    probe.advance(100);
    expect(probe.value).toBe(true);
    probe.advance(100);
    expect(probe.value).toBe(false);
    probe.unmount();
  });
});

describe("overlay motion 常量与 variants", () => {
  it("OD_MS / OD_EASE 与 motion.css 数值逐一对应", () => {
    expect(OD_MS).toEqual({
      overlayIn: 250,
      overlayOut: 200,
      modalIn: 420,
      modalOut: 200,
      popIn: 280,
      popOut: 150,
      sheetIn: 400,
      sheetOut: 300,
    });
    expect(OD_EASE.standard).toEqual([0.4, 0, 0.2, 1]);
    expect(OD_EASE.decelerate).toEqual([0, 0, 0.2, 1]);
    expect(OD_EASE.accelerate).toEqual([0.3, 0, 1, 1]);
    expect(OD_EASE.springIn).toEqual([0.34, 1.4, 0.64, 1]);
    expect(OD_EASE.sheetIn).toEqual([0.32, 0.72, 0, 1]);
  });

  it("variants 目标值与 motion.css 关键帧对应", () => {
    expect(overlayVariants.open).toMatchObject({ opacity: 1 });
    expect(overlayVariants.closed).toMatchObject({ opacity: 0 });

    // 弹窗：scale 0.88→1，opacity 在 60% 关键帧处先到 1（同原 od-spring-in）
    expect(modalVariants.open).toMatchObject({ scale: [0.88, 1] });
    expect(modalVariants.closed).toMatchObject({ opacity: 0, scale: 0.92 });

    // 轻量浮层：小行程弹簧 0.96→1，退出 0.97
    expect(popVariants.open).toMatchObject({ opacity: [0, 1], scale: [0.96, 1] });
    expect(popVariants.closed).toMatchObject({ opacity: 0, scale: 0.97 });

    // 抽屉：方向滑入（open 归位）/ 滑出（closed ±100%）
    expect(sheetVariants("right").open).toMatchObject({ x: 0, y: 0 });
    expect(sheetVariants("right").closed).toMatchObject({ x: "100%", y: 0 });
    expect(sheetVariants("left").closed).toMatchObject({ x: "-100%", y: 0 });
    expect(sheetVariants("top").closed).toMatchObject({ x: 0, y: "-100%" });
    expect(sheetVariants("bottom").closed).toMatchObject({ x: 0, y: "100%" });
  });
});

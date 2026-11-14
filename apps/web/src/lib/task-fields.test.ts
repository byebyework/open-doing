import { describe, expect, it } from "vitest";

import {
  assertStartNotAfterTaskDue,
  COMMENT_MAX_LENGTH,
  isUuid,
  validateCommentContent,
  validateTaskDescription,
  validateTaskDueDate,
  validateTaskPriority,
  validateTaskStartDate,
  validateTaskStatus,
  validateTaskTitle,
} from "./task-fields";

const UUID = "00000000-0000-0000-0000-000000000001";

describe("isUuid", () => {
  it("接受标准 UUID，拒绝拼接字符串", () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

describe("validateTaskTitle", () => {
  it("去除首尾空白后返回标题", () => {
    expect(validateTaskTitle("  写文档  ")).toBe("写文档");
  });

  it("空标题按字段 title 报错，文案随 label 变化", () => {
    expect(() => validateTaskTitle("   ")).toThrow(
      expect.objectContaining({ name: "DomainError", field: "title", message: "请输入任务标题" }),
    );
    expect(() => validateTaskTitle(null, "子任务")).toThrow(
      expect.objectContaining({ message: "请输入子任务标题" }),
    );
  });

  it("超长标题按字段 title 报错", () => {
    expect(() => validateTaskTitle("x".repeat(201))).toThrow(
      expect.objectContaining({ field: "title", message: "任务标题不能超过 200 个字符" }),
    );
  });
});

describe("validateTaskDescription（基础语义）", () => {
  it("非字符串与空白返回 null", () => {
    expect(validateTaskDescription(undefined)).toBeNull();
    expect(validateTaskDescription("   ")).toBeNull();
  });

  it("保留去空白后的正文", () => {
    expect(validateTaskDescription("  背景  ")).toBe("背景");
  });
});

describe("validateTaskDueDate", () => {
  it("空值统一为 null", () => {
    expect(validateTaskDueDate(undefined)).toBeNull();
    expect(validateTaskDueDate(null)).toBeNull();
    expect(validateTaskDueDate("")).toBeNull();
  });

  it("接受真实存在的 YYYY-MM-DD", () => {
    expect(validateTaskDueDate("2026-10-23")).toBe("2026-10-23");
  });

  it("格式错误与不存在的日期都按字段 dueDate 报错", () => {
    expect(() => validateTaskDueDate("2026/10/23")).toThrow(
      expect.objectContaining({ field: "dueDate", message: "截止日期格式应为 YYYY-MM-DD" }),
    );
    expect(() => validateTaskDueDate("2026-02-30")).toThrow(
      expect.objectContaining({ field: "dueDate", message: "截止日期不是有效日期" }),
    );
  });
});

describe("validateTaskStartDate", () => {
  it("空值统一为 null", () => {
    expect(validateTaskStartDate(undefined)).toBeNull();
    expect(validateTaskStartDate(null)).toBeNull();
    expect(validateTaskStartDate("")).toBeNull();
  });

  it("接受真实存在的 YYYY-MM-DD", () => {
    expect(validateTaskStartDate("2026-10-20")).toBe("2026-10-20");
  });

  it("格式错误与不存在的日期都按字段 startDate 报错", () => {
    expect(() => validateTaskStartDate("2026/10/20")).toThrow(
      expect.objectContaining({ field: "startDate", message: "开始时间格式应为 YYYY-MM-DD" }),
    );
    expect(() => validateTaskStartDate("2026-02-30")).toThrow(
      expect.objectContaining({ field: "startDate", message: "开始时间不是有效日期" }),
    );
  });
});

describe("assertStartNotAfterTaskDue", () => {
  it("开始时间晚于截止时间时报错，字段为 startDate", () => {
    expect(() => assertStartNotAfterTaskDue("2026-10-24", "2026-10-23")).toThrow(
      expect.objectContaining({ field: "startDate", message: "开始时间不能晚于截止时间" }),
    );
  });

  it("同日、早于或任一为空都不报错", () => {
    expect(() => assertStartNotAfterTaskDue("2026-10-23", "2026-10-23")).not.toThrow();
    expect(() => assertStartNotAfterTaskDue("2026-10-22", "2026-10-23")).not.toThrow();
    expect(() => assertStartNotAfterTaskDue("2026-10-22", null)).not.toThrow();
    expect(() => assertStartNotAfterTaskDue(null, "2026-10-23")).not.toThrow();
  });
});

describe("validateTaskStatus", () => {
  it("接受三态，拒绝其他值", () => {
    expect(validateTaskStatus("todo")).toBe("todo");
    expect(validateTaskStatus("in_progress")).toBe("in_progress");
    expect(validateTaskStatus("done")).toBe("done");
    expect(() => validateTaskStatus("archived")).toThrow(
      expect.objectContaining({ field: "status", message: "任务状态不合法" }),
    );
  });
});

describe("validateTaskPriority", () => {
  it("接受三档，拒绝其他值", () => {
    expect(validateTaskPriority("low")).toBe("low");
    expect(validateTaskPriority("medium")).toBe("medium");
    expect(validateTaskPriority("high")).toBe("high");
    expect(() => validateTaskPriority("urgent")).toThrow(
      expect.objectContaining({ field: "priority", message: "任务优先级不合法" }),
    );
  });
});

describe("validateCommentContent", () => {
  it("去除首尾空白后返回内容", () => {
    expect(validateCommentContent("  收到  ")).toBe("收到");
  });

  it("空内容与超长内容按字段 content 报错", () => {
    expect(() => validateCommentContent("  ")).toThrow(
      expect.objectContaining({ field: "content", message: "请输入评论内容" }),
    );
    expect(() => validateCommentContent("x".repeat(COMMENT_MAX_LENGTH + 1))).toThrow(
      expect.objectContaining({ field: "content" }),
    );
  });
});

describe("字段长度上限（2026-11-14 收紧）", () => {
  it("子任务标题 101 字 → subtaskTitleTooLong（max: 100）", () => {
    expect(() => validateTaskTitle("1".repeat(101), "子任务")).toThrow(
      expect.objectContaining({
        field: "title",
        i18n: { key: "subtaskTitleTooLong", params: { max: 100 } },
      }),
    );
  });

  it("子任务标题 100 字通过", () => {
    expect(validateTaskTitle("1".repeat(100), "子任务")).toHaveLength(100);
  });

  it("评论 501 字 → commentTooLong（max: 500）；500 字通过", () => {
    expect(() => validateCommentContent("1".repeat(501))).toThrow(
      expect.objectContaining({
        field: "content",
        i18n: { key: "commentTooLong", params: { max: 500 } },
      }),
    );
    expect(validateCommentContent("1".repeat(500))).toHaveLength(500);
  });

  it("描述 801 字 → descriptionTooLong（max: 800）", () => {
    expect(() => validateTaskDescription("1".repeat(801))).toThrow(
      expect.objectContaining({
        field: "description",
        i18n: { key: "descriptionTooLong", params: { max: 800 } },
      }),
    );
  });

  it("描述 800 字通过；空串/纯空白 → null", () => {
    expect(validateTaskDescription("1".repeat(800))).toHaveLength(800);
    expect(validateTaskDescription("   ")).toBeNull();
    expect(validateTaskDescription(undefined)).toBeNull();
  });

  it("标题 201 字仍拒绝、200 字仍通过（口径不变）", () => {
    expect(() => validateTaskTitle("1".repeat(201))).toThrow();
    expect(validateTaskTitle("1".repeat(200))).toHaveLength(200);
  });
});

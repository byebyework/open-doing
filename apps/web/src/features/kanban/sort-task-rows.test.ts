import { describe, expect, it } from "vitest";

import type { TaskPriority, TaskStatus } from "@open-doing/types";

import {
  DEFAULT_LIST_FILTERS,
  filterTaskRows,
  type ListFilters,
} from "./sort-task-rows";

interface Row {
  id: string;
  status: TaskStatus;
  priority: TaskPriority;
  projectId: string;
}

const ROWS: Row[] = [
  { id: "t1", status: "todo", priority: "high", projectId: "p1" },
  { id: "t2", status: "in_progress", priority: "medium", projectId: "p1" },
  { id: "t3", status: "done", priority: "low", projectId: "p2" },
  { id: "t4", status: "todo", priority: "medium", projectId: "p2" },
];

function ids(rows: Row[]): string[] {
  return rows.map((row) => row.id);
}

function filters(patch: Partial<ListFilters>): ListFilters {
  return { ...DEFAULT_LIST_FILTERS, ...patch };
}

describe("filterTaskRows（列表视图本地行过滤）", () => {
  it("默认全 all：不过滤任何行，且返回新数组", () => {
    const result = filterTaskRows(ROWS, DEFAULT_LIST_FILTERS);

    expect(ids(result)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(result).not.toBe(ROWS);
  });

  it("按 status 过滤", () => {
    expect(ids(filterTaskRows(ROWS, filters({ status: "todo" })))).toEqual([
      "t1",
      "t4",
    ]);
  });

  it("按 priority 过滤", () => {
    expect(
      ids(filterTaskRows(ROWS, filters({ priority: "medium" }))),
    ).toEqual(["t2", "t4"]);
  });

  it("status + priority 交集组合", () => {
    expect(
      ids(filterTaskRows(ROWS, filters({ status: "todo", priority: "medium" }))),
    ).toEqual(["t4"]);
  });

  it("无匹配返回空数组", () => {
    expect(
      filterTaskRows(ROWS, filters({ status: "done", priority: "high" })),
    ).toEqual([]);
  });

  it("保序且不修改输入数组", () => {
    const before = ROWS.slice();

    const result = filterTaskRows(ROWS, filters({ status: "todo" }));

    expect(ids(result)).toEqual(["t1", "t4"]);
    expect(ROWS).toEqual(before);
  });

  it("ListFilters 不再含 projectId（类型层收缩，项目过滤已交还服务端 URL 筛选）", () => {
    // @ts-expect-error projectId 字段已从 ListFilters 移除，传入应报类型错误。
    const stale: ListFilters = { ...DEFAULT_LIST_FILTERS, projectId: "p2" };

    // 运行时容忍多余字段（结构化类型）：按 status/priority 全 all 不过滤。
    expect(ids(filterTaskRows(ROWS, stale))).toEqual(["t1", "t2", "t3", "t4"]);
  });
});

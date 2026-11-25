import { describe, expect, it } from "vitest";

import {
  appendTaskOrigin,
  parseTaskOrigin,
  parseTaskPage,
  parseTaskPageSize,
  projectTasksBackHref,
  taskModuleBackHref,
} from "./task-origin";

describe("parseTaskPage", () => {
  it("接受正整数（含数组首项），其余一律 null", () => {
    expect(parseTaskPage("2")).toBe(2);
    expect(parseTaskPage(["3", "4"])).toBe(3);
    expect(parseTaskPage("0")).toBeNull();
    expect(parseTaskPage("-1")).toBeNull();
    expect(parseTaskPage("2.5")).toBeNull();
    expect(parseTaskPage("abc")).toBeNull();
    expect(parseTaskPage(undefined)).toBeNull();
  });
});

describe("parseTaskPageSize", () => {
  it("只接受白名单 10 / 20 / 50", () => {
    expect(parseTaskPageSize("10")).toBe(10);
    expect(parseTaskPageSize("20")).toBe(20);
    expect(parseTaskPageSize("50")).toBe(50);
    expect(parseTaskPageSize("30")).toBeNull();
    expect(parseTaskPageSize(undefined)).toBeNull();
  });
});

describe("parseTaskOrigin", () => {
  it("无 from=tasks 时视为项目来源", () => {
    expect(parseTaskOrigin({})).toEqual({
      fromTasks: false,
      fromProject: false,
      status: null,
      priority: null,
      tag: null,
      view: null,
      page: null,
      pageSize: null,
    });
    expect(parseTaskOrigin({ from: "project" }).fromTasks).toBe(false);
  });

  it("任务模块来源解析列表视图与分页参数", () => {
    expect(
      parseTaskOrigin({ from: "tasks", view: "list", page: "2", size: "20" }),
    ).toEqual({
      fromTasks: true,
      fromProject: false,
      status: null,
      priority: null,
      tag: null,
      view: "list",
      page: 2,
      pageSize: 20,
    });
  });

  it("看板来源没有 view / 分页参数", () => {
    expect(parseTaskOrigin({ from: "tasks" })).toEqual({
      fromTasks: true,
      fromProject: false,
      status: null,
      priority: null,
      tag: null,
      view: null,
      page: null,
      pageSize: null,
    });
  });

  it("非法 view / page / size 静默回退为 null", () => {
    expect(
      parseTaskOrigin({ from: "tasks", view: "board", page: "x", size: "30" }),
    ).toEqual({
      fromTasks: true,
      fromProject: false,
      status: null,
      priority: null,
      tag: null,
      view: null,
      page: null,
      pageSize: null,
    });
  });
});

describe("appendTaskOrigin", () => {
  it("默认追加 from=tasks", () => {
    expect(appendTaskOrigin("/space/t/projects/p/tasks/1")).toBe(
      "/space/t/projects/p/tasks/1?from=tasks",
    );
  });

  it("列表来源追加 view，默认页码 / 条数不写进 URL", () => {
    expect(
      appendTaskOrigin("/t/1", { view: "list", page: 1, pageSize: 10 }),
    ).toBe("/t/1?from=tasks&view=list");
  });

  it("非首页 / 非默认条数写入 page 与 size", () => {
    expect(
      appendTaskOrigin("/t/1", { view: "list", page: 3, pageSize: 20 }),
    ).toBe("/t/1?from=tasks&view=list&page=3&size=20");
  });

  it("fromTasks: false 且无其它参数时原样返回", () => {
    expect(appendTaskOrigin("/t/1", { fromTasks: false })).toBe("/t/1");
  });

  it("已有 query 的 href 用 & 连接", () => {
    expect(appendTaskOrigin("/t/1?x=1")).toBe("/t/1?x=1&from=tasks");
  });
});

describe("taskModuleBackHref", () => {
  it("列表来源回到同一页（保留 view / page / size）", () => {
    expect(
      taskModuleBackHref("growth-squad", {
        fromTasks: true,
        fromProject: false,
        status: null,
        priority: null,
        tag: null,
        view: "list",
        page: 2,
        pageSize: 20,
      }),
    ).toBe("/space/growth-squad/tasks?view=list&page=2&size=20");
  });

  it("看板来源回到模块默认看板", () => {
    expect(
      taskModuleBackHref("personal", {
        fromTasks: true,
        fromProject: false,
        status: null,
        priority: null,
        tag: null,
        view: null,
        page: null,
        pageSize: null,
      }),
    ).toBe("/space/personal/tasks");
  });

  it("非任务模块来源只回模块根地址", () => {
    expect(
      taskModuleBackHref("personal", {
        fromTasks: false,
        fromProject: false,
        status: null,
        priority: null,
        tag: null,
        view: null,
        page: null,
        pageSize: null,
      }),
    ).toBe("/space/personal/tasks");
  });
});

describe("from=project origin", () => {
  it("parseTaskOrigin 解析 from=project 连同 view/page/size", () => {
    expect(
      parseTaskOrigin({ from: "project", view: "list", page: "2", size: "20" }),
    ).toEqual({
      fromTasks: false,
      fromProject: true,
      status: null,
      priority: null,
      tag: null,
      view: "list",
      page: 2,
      pageSize: 20,
    });
  });

  it("appendTaskOrigin fromProject 优先于 fromTasks", () => {
    expect(
      appendTaskOrigin("/space/personal/projects/p", {
        fromTasks: true,
        fromProject: true,
        status: null,
        priority: null,
        tag: null,
        view: "list",
        page: 2,
        pageSize: 20,
      }),
    ).toBe("/space/personal/projects/p?from=project&view=list&page=2&size=20");
  });

  it("projectTasksBackHref 看板来源 → ?tab=tasks；列表来源带 view/page/size", () => {
    expect(
      projectTasksBackHref("/space/personal/projects/p", {
        fromTasks: false,
        fromProject: true,
        status: null,
        priority: null,
        tag: null,
        view: null,
        page: null,
        pageSize: null,
      }),
    ).toBe("/space/personal/projects/p?tab=tasks");
    expect(
      projectTasksBackHref("/space/growth-squad/projects/p", {
        fromTasks: false,
        fromProject: true,
        status: null,
        priority: null,
        tag: null,
        view: "list",
        page: 2,
        pageSize: 20,
      }),
    ).toBe("/space/growth-squad/projects/p?tab=tasks&view=list&page=2&size=20");
  });

  it("fromProject=false 时 projectTasksBackHref 原样返回", () => {
    expect(
      projectTasksBackHref("/space/personal/projects/p", {
        fromTasks: false,
        fromProject: false,
        status: null,
        priority: null,
        tag: null,
        view: null,
        page: null,
        pageSize: null,
      }),
    ).toBe("/space/personal/projects/p");
  });

  it("parseTaskOrigin 解析筛选参数，缺省为 null", () => {
    expect(
      parseTaskOrigin({
        from: "project",
        status: "in_progress",
        priority: "high",
        tag: "t1",
      }),
    ).toEqual({
      fromTasks: false,
      fromProject: true,
      status: "in_progress",
      priority: "high",
      tag: "t1",
      view: null,
      page: null,
      pageSize: null,
    });
    expect(parseTaskOrigin({ from: "project" }).status).toBeNull();
  });

  it("projectTasksBackHref 附带筛选参数（缺省 null 不写）", () => {
    expect(
      projectTasksBackHref("/space/personal/projects/p", {
        fromTasks: false,
        fromProject: true,
        status: "in_progress",
        priority: null,
        tag: "t1",
        view: "list",
        page: null,
        pageSize: null,
      }),
    ).toBe(
      "/space/personal/projects/p?tab=tasks&status=in_progress&tag=t1&view=list",
    );
  });

  it("taskModuleBackHref 不携带筛选参数（任务模块筛选是本地态，不进 URL）", () => {
    expect(
      taskModuleBackHref("personal", {
        fromTasks: true,
        fromProject: false,
        status: "todo",
        priority: "high",
        tag: "t1",
        view: "list",
        page: null,
        pageSize: null,
      }),
    ).toBe("/space/personal/tasks?view=list");
  });
});

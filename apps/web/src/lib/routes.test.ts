import { describe, expect, it } from "vitest";
import {
  createTeamHref,
  invitesHref,
  joinTeamHref,
  moduleHref,
  personalProjectHref,
  personalTaskHref,
  spaceDashboardHref,
  teamProjectHref,
  teamProjectNewHref,
  teamSettingsHref,
  teamTaskHref,
} from "./routes";

describe("spaceDashboardHref", () => {
  it("拼接 /space/{spaceRef}/dashboard", () => {
    expect(spaceDashboardHref("personal")).toBe("/space/personal/dashboard");
    expect(spaceDashboardHref("growth")).toBe("/space/growth/dashboard");
  });
});

describe("moduleHref", () => {
  it("拼接 /space/{spaceRef}/{module}", () => {
    expect(moduleHref("personal", "kanban")).toBe("/space/personal/kanban");
    expect(moduleHref("growth", "analysis")).toBe("/space/growth/analysis");
    expect(moduleHref("growth", "settings")).toBe("/space/growth/settings");
  });
});

describe("personalTaskHref", () => {
  it("拼接 /space/personal/tasks/{taskId}", () => {
    expect(personalTaskHref("t1")).toBe("/space/personal/tasks/t1");
  });
});

describe("personalProjectHref", () => {
  it("拼接 /space/personal/projects/{projectSlug}", () => {
    expect(personalProjectHref("site")).toBe("/space/personal/projects/site");
  });
});

describe("teamTaskHref", () => {
  it("拼接 /space/{teamSlug}/projects/{projectSlug}/tasks/{taskId}", () => {
    expect(teamTaskHref("growth", "site", "t1")).toBe(
      "/space/growth/projects/site/tasks/t1",
    );
  });
});

describe("teamProjectHref", () => {
  it("拼接 /space/{teamSlug}/projects/{projectSlug}", () => {
    expect(teamProjectHref("growth", "site")).toBe(
      "/space/growth/projects/site",
    );
  });
});

describe("teamProjectNewHref", () => {
  it("拼接 /space/{teamSlug}/projects/new", () => {
    expect(teamProjectNewHref("growth")).toBe("/space/growth/projects/new");
  });
});

describe("teamSettingsHref", () => {
  it("拼接 /space/{teamSlug}/settings", () => {
    expect(teamSettingsHref("growth")).toBe("/space/growth/settings");
  });
});

describe("invitesHref", () => {
  it("返回 /invites", () => {
    expect(invitesHref()).toBe("/invites");
  });
});

describe("createTeamHref", () => {
  it("返回 /teams/new", () => {
    expect(createTeamHref()).toBe("/teams/new");
  });
});

describe("joinTeamHref", () => {
  it("返回 /teams/join", () => {
    expect(joinTeamHref()).toBe("/teams/join");
  });
});

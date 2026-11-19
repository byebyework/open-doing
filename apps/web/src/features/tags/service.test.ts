import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DomainError } from "@/lib/domain-error";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { taskTags, teamMemberships, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";
import { TeamPermissionError } from "@/features/teams/permissions";
import { createTeam } from "@/features/teams/service";
import { createTeamProject } from "@/features/projects/service";
import { createTeamTask } from "@/features/tasks/service";

import { TAGS_PER_SPACE_LIMIT } from "./constants";
import { createTag, deleteTag, listTags, updateTag } from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[tags/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

/** 直插用户，避免每个用例都走 better-auth 密码哈希。 */
async function createUser(db: DbClient, username: string): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await db
    .insert(users)
    .values({ id, uid: generateUid(), username, name: username, email: `${id}@test.local`, displayUsername: username });
  return { id };
}

let teamSequence = 0;

async function setupTeam(db: DbClient): Promise<{
  owner: { id: string };
  team: { id: string; slug: string };
}> {
  teamSequence += 1;
  const owner = await createUser(db, `tag-owner-${teamSequence}`);
  const team = await createTeam({ name: "Tag Squad" }, owner.id, db);
  return { owner, team };
}

/** 直插成员关系（owner 由 createTeam 自动建立，其他角色用本函数）。 */
async function addMember(
  db: DbClient,
  teamId: string,
  userId: string,
  role: "owner" | "admin" | "member",
): Promise<void> {
  await db.insert(teamMemberships).values({ teamId, userId, role });
}

describe.skipIf(!hasTestDatabase)("标签池 service", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("owner 建标签并读取列表（含 usageCount）", async () => {
    const { owner, team } = await setupTeam(db);

    const tag = await createTag(
      { teamId: team.id, actorId: owner.id, name: "调研", color: "purple" },
      db,
    );
    expect(tag).toMatchObject({
      teamId: team.id,
      ownerId: null,
      name: "调研",
      color: "purple",
    });

    const rows = await listTags({ teamId: team.id }, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: tag.id, usageCount: 0 });
  });

  it("改名 / 换色生效；名字未传保持不变", async () => {
    const { owner, team } = await setupTeam(db);
    const tag = await createTag(
      { teamId: team.id, actorId: owner.id, name: "Bug", color: "coral" },
      db,
    );

    const renamed = await updateTag(
      { teamId: team.id, actorId: owner.id, tagId: tag.id, name: "缺陷", color: "mint" },
      db,
    );
    expect(renamed).toMatchObject({ name: "缺陷", color: "mint" });

    const onlyColor = await updateTag(
      { teamId: team.id, actorId: owner.id, tagId: tag.id, color: "sky" },
      db,
    );
    expect(onlyColor).toMatchObject({ name: "缺陷", color: "sky" });
  });

  it("删除标签并级联清理 task_tags", async () => {
    const { owner, team } = await setupTeam(db);
    const tag = await createTag(
      { teamId: team.id, actorId: owner.id, name: "Frontend", color: "lavender" },
      db,
    );
    const project = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Cascade Project" },
      db,
    );
    const task = await createTeamTask(
      {
        teamId: team.id,
        actorId: owner.id,
        projectId: project.id,
        title: "Tagged task",
      },
      db,
    );
    await db.insert(taskTags).values({ taskId: task.id, tagId: tag.id });

    await deleteTag({ teamId: team.id, actorId: owner.id, tagId: tag.id }, db);

    const remaining = await db
      .select()
      .from(taskTags)
      .where(eq(taskTags.tagId, tag.id));
    expect(remaining).toHaveLength(0);
  });

  it("同空间同名被拒（tagNameDuplicate）；不同空间互不影响", async () => {
    const { owner, team } = await setupTeam(db);
    const personal = await createUser(db, "tag-personal");
    await createTag(
      { teamId: team.id, actorId: owner.id, name: "调研", color: "purple" },
      db,
    );

    await expect(
      createTag({ teamId: team.id, actorId: owner.id, name: "调研", color: "mint" }, db),
    ).rejects.toMatchObject({ i18n: { key: "tagNameDuplicate" }, field: "name" });

    // 个人空间与团队空间是不同池，同名合法。
    await expect(
      createTag({ ownerId: personal.id, name: "调研", color: "mint" }, db),
    ).resolves.toMatchObject({ ownerId: personal.id, teamId: null });
  });

  it("member 不能管理标签池（TeamPermissionError）", async () => {
    const { team } = await setupTeam(db);
    const member = await createUser(db, "tag-member");
    await addMember(db, team.id, member.id, "member");

    await expect(
      createTag({ teamId: team.id, actorId: member.id, name: "Hack", color: "purple" }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);
  });

  it("标签数达到空间上限后拒绝新建（tagLimitReached）", async () => {
    const { owner, team } = await setupTeam(db);
    for (let i = 0; i < TAGS_PER_SPACE_LIMIT; i += 1) {
      await createTag(
        { teamId: team.id, actorId: owner.id, name: `tag-${i}`, color: "purple" },
        db,
      );
    }

    await expect(
      createTag({ teamId: team.id, actorId: owner.id, name: "over", color: "mint" }, db),
    ).rejects.toMatchObject({ i18n: { key: "tagLimitReached" } });
  });

  it("个人分支：owner 建删自由；他人身份兜底", async () => {
    const owner = await createUser(db, "tag-me");
    const tag = await createTag(
      { ownerId: owner.id, name: "生活", color: "tangerine" },
      db,
    );
    expect(tag).toMatchObject({ ownerId: owner.id, teamId: null });

    const rows = await listTags({ ownerId: owner.id }, db);
    expect(rows).toHaveLength(1);

    await deleteTag({ ownerId: owner.id, tagId: tag.id }, db);
    expect(await listTags({ ownerId: owner.id }, db)).toHaveLength(0);

    // actorId 与 ownerId 不一致（action 层不会构造）用普通 Error 兜底。
    await expect(
      createTag({ ownerId: owner.id, actorId: "someone-else", name: "X", color: "mint" }, db),
    ).rejects.toBeInstanceOf(Error);
  });

  it("校验：空名 / 超长名 / 非法颜色 / 不存在的标签", async () => {
    const { owner, team } = await setupTeam(db);

    await expect(
      createTag({ teamId: team.id, actorId: owner.id, name: "   ", color: "mint" }, db),
    ).rejects.toMatchObject({ i18n: { key: "nameRequired" } });

    await expect(
      createTag(
        { teamId: team.id, actorId: owner.id, name: "x".repeat(21), color: "mint" },
        db,
      ),
    ).rejects.toMatchObject({ i18n: { key: "nameTooLong" }, field: "name" });

    await expect(
      createTag(
        { teamId: team.id, actorId: owner.id, name: "Ok", color: "blue" as never },
        db,
      ),
    ).rejects.toMatchObject({ i18n: { key: "colorInvalid" }, field: "color" });

    await expect(
      updateTag(
        { teamId: team.id, actorId: owner.id, tagId: crypto.randomUUID(), name: "Nope" },
        db,
      ),
    ).rejects.toMatchObject({ i18n: { key: "tagNotFound" } });
  });

  it("listTags 附使用计数（打过标的任务数）", async () => {
    const { owner, team } = await setupTeam(db);
    const tag = await createTag(
      { teamId: team.id, actorId: owner.id, name: "Used", color: "sky" },
      db,
    );
    const project = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Usage Project" },
      db,
    );
    for (const title of ["T1", "T2"]) {
      const task = await createTeamTask(
        { teamId: team.id, actorId: owner.id, projectId: project.id, title },
        db,
      );
      await db.insert(taskTags).values({ taskId: task.id, tagId: tag.id });
    }

    const rows = await listTags({ teamId: team.id }, db);
    expect(rows[0]).toMatchObject({ id: tag.id, usageCount: 2 });
  });
});

import { desc, eq, inArray } from "drizzle-orm";

import { displayName, type ProjectActivityType } from "@open-doing/types";

import type { DbClient } from "@/server/db/client";
import { db } from "@/server/db/client";
import {
  projectActivities,
  projectComments,
  projects,
  tags,
  users,
  type ProjectActivityPayload,
} from "@/server/db/schema";

type ProjectRow = typeof projects.$inferSelect;

/** 标量字段 → 活动类型（diff 落动态的映射，spec §4）。 */
const SCALAR_ACTIVITY_FIELDS: Array<{
  field: "name" | "summary" | "description" | "startDate" | "endDate" | "priority" | "status";
  type: ProjectActivityType;
}> = [
  { field: "name", type: "name" },
  { field: "summary", type: "summary" },
  { field: "description", type: "description" },
  { field: "startDate", type: "start_date" },
  { field: "endDate", type: "end_date" },
  { field: "priority", type: "priority" },
  { field: "status", type: "status" },
];

/** 集合相等（顺序无关）：无变化不落动态。 */
function sameIdSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

/** 成员 / 标签集合 diff：有变化才落一条 refs 快照行（按 name 稳定排序）。 */
export async function recordRefsDiffActivity(
  input: {
    projectId: string;
    actorId: string;
    type: "members" | "tags";
    fromIds: string[];
    toIds: string[];
    resolve: (ids: string[], client: DbClient) => Promise<Array<{ id: string; name: string }>>;
  },
  client: DbClient,
): Promise<void> {
  if (sameIdSet(input.fromIds, input.toIds)) return;

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const [from, to] = await Promise.all([
    input.resolve(input.fromIds, client),
    input.resolve(input.toIds, client),
  ]);
  from.sort(byName);
  to.sort(byName);

  await recordProjectActivity(
    {
      projectId: input.projectId,
      actorId: input.actorId,
      type: input.type,
      payload: { kind: "refs", from, to },
    },
    client,
  );
}

/**
 * 标量字段 + 负责人 diff 落动态：existing → row 实际变化的字段各一行
 * （lead 用显示名快照，null = 清空；个人项目恒无 lead，两段皆幂等跳过）。
 */
export async function recordProjectScalarDiffActivity(
  input: { projectId: string; actorId: string; existing: ProjectRow; row: ProjectRow },
  client: DbClient,
): Promise<void> {
  const { projectId, actorId, existing, row } = input;

  for (const { field, type } of SCALAR_ACTIVITY_FIELDS) {
    const from = existing[field];
    const to = row[field];
    if (from === to) continue;
    await recordProjectActivity(
      {
        projectId,
        actorId,
        type,
        payload: {
          kind: "scalar",
          from: (from as string | null) ?? null,
          to: (to as string | null) ?? null,
        },
      },
      client,
    );
  }

  if (existing.leadId !== row.leadId) {
    const ids = [existing.leadId, row.leadId].filter(
      (id): id is string => id !== null,
    );
    const refs = await resolveUserRefs(ids, client);
    const nameOf = (id: string | null): string | null =>
      id === null ? null : refs.find((ref) => ref.id === id)?.name ?? null;
    await recordProjectActivity(
      {
        projectId,
        actorId,
        type: "lead",
        payload: {
          kind: "scalar",
          from: nameOf(existing.leadId),
          to: nameOf(row.leadId),
        },
      },
      client,
    );
  }
}

/** 记录一条项目动态（append-only；调用方负责 diff 与鉴权）。 */
export async function recordProjectActivity(
  input: {
    projectId: string;
    actorId: string;
    type: ProjectActivityType;
    payload?: ProjectActivityPayload;
  },
  client: DbClient = db,
): Promise<void> {
  await client.insert(projectActivities).values({
    projectId: input.projectId,
    actorId: input.actorId,
    type: input.type,
    payload: input.payload ?? null,
  });
}

/** 时间线条目：动态与评论合并后的判别联合（RSC → client 可序列化）。 */
export type TimelineItem =
  | {
      kind: "activity";
      id: string;
      type: ProjectActivityType;
      payload: ProjectActivityPayload | null;
      createdAt: string;
      actor: { id: string; name: string };
    }
  | {
      kind: "comment";
      id: string;
      content: string;
      createdAt: string;
      author: { id: string; name: string };
      /** 回复（单层楼中楼，createdAt 升序）；回复本身不占顶层位置。 */
      replies: Array<{
        id: string;
        content: string;
        createdAt: string;
        author: { id: string; name: string };
      }>;
    };

/**
 * 项目时间线：动态 + 根评论按 createdAt 倒序合并，取前 `limit` 条
 * （缺省 100）；回复嵌套在根评论的 `replies` 下（升序），不参与顶层
 * 排序。actor / author 显示名在读取时从 users 解析（与任务评论口径
 * 一致；用户删除随 FK 级联带走其动态）。
 */
export async function listProjectTimeline(
  projectId: string,
  options: { limit?: number } = {},
  client: DbClient = db,
): Promise<TimelineItem[]> {
  const limit = options.limit ?? 100;

  const [activities, comments] = await Promise.all([
    client
      .select()
      .from(projectActivities)
      .where(eq(projectActivities.projectId, projectId))
      .orderBy(desc(projectActivities.createdAt))
      .limit(limit),
    client
      .select()
      .from(projectComments)
      .where(eq(projectComments.projectId, projectId))
      .orderBy(desc(projectComments.createdAt))
      .limit(limit),
  ]);

  const userIds = [
    ...new Set([
      ...activities.map((row) => row.actorId),
      ...comments.map((row) => row.authorId),
    ]),
  ];
  const nameById = await resolveUserRefs(userIds, client).then((refs) =>
    new Map(refs.map((ref) => [ref.id, ref.name])),
  );

  // 回复先按根分组；顶层只留根评论（回复随根参与倒序，自身不占位）。
  const repliesByRoot = new Map<
    string,
    Array<{ id: string; content: string; createdAt: string; author: { id: string; name: string } }>
  >();
  for (const row of comments) {
    if (!row.parentId) continue;
    const reply = {
      id: row.id,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      author: { id: row.authorId, name: nameById.get(row.authorId) ?? "" },
    };
    const list = repliesByRoot.get(row.parentId) ?? [];
    list.push(reply);
    repliesByRoot.set(row.parentId, list);
  }
  for (const list of repliesByRoot.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  const items: TimelineItem[] = [
    ...activities.map(
      (row): TimelineItem => ({
        kind: "activity",
        id: row.id,
        type: row.type,
        payload: row.payload,
        createdAt: row.createdAt.toISOString(),
        actor: {
          id: row.actorId,
          name: nameById.get(row.actorId) ?? "",
        },
      }),
    ),
    ...comments
      .filter((row) => row.parentId === null)
      .map(
        (row): TimelineItem => ({
          kind: "comment",
          id: row.id,
          content: row.content,
          createdAt: row.createdAt.toISOString(),
          author: {
            id: row.authorId,
            name: nameById.get(row.authorId) ?? "",
          },
          replies: repliesByRoot.get(row.id) ?? [],
        }),
      ),
  ];

  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return items.slice(0, limit);
}

/**
 * 按入参顺序解析用户显示名（`users.name` 即 better-auth 的展示名）；
 * 未知 id 丢弃。
 */
export async function resolveUserRefs(
  ids: string[],
  client: DbClient = db,
): Promise<Array<{ id: string; name: string }>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const rows = await client
    .select({ id: users.id, nickname: users.name, username: users.username })
    .from(users)
    .where(inArray(users.id, unique));
  const nameById = new Map(
    rows.map((row) => [
      row.id,
      displayName({ nickname: row.nickname, username: row.username }),
    ]),
  );

  return unique
    .filter((id) => nameById.has(id))
    .map((id) => ({ id, name: nameById.get(id)! }));
}

/** 按入参顺序解析标签名；未知 id 丢弃。 */
export async function resolveTagRefs(
  ids: string[],
  client: DbClient = db,
): Promise<Array<{ id: string; name: string }>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const rows = await client
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(inArray(tags.id, unique));
  const nameById = new Map(rows.map((row) => [row.id, row.name]));

  return unique
    .filter((id) => nameById.has(id))
    .map((id) => ({ id, name: nameById.get(id)! }));
}

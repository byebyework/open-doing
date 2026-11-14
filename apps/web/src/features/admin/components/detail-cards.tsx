import { displayName } from "@open-doing/types";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { CARD_SHELL } from "@/components/ui/card";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Badge } from "@/components/ui/shadcn/badge";
import { formatTaskTimestamp } from "@/lib/date-display";

import type { AdminUserDetail } from "../service";

type DetailUser = AdminUserDetail["user"];
type DetailTeam = AdminUserDetail["teams"][number];
type DetailSession = AdminUserDetail["sessions"][number];

/** 徽标样式（与用户列表页一致：12px 半粗、紧凑内边距）。 */
const BADGE_CLASS = "px-2 py-0 text-[12px] font-semibold";

/** 状态 / 身份徽标颜色（原型 .badge-disabled / .badge-admin / 普通用户灰）。 */
const BADGE_DISABLED = "bg-[var(--error-bg)] text-[var(--error)]";
const BADGE_ADMIN = "bg-[var(--primary-bg)] text-[var(--purple-600)]";
const BADGE_MEMBER = "bg-[var(--surface-inset)] text-[var(--muted-foreground)]";

/** 团队角色 -> teams 命名空间 key（与 MemberList 口径一致）。 */
const TEAM_ROLE_KEYS = {
  owner: "roleOwner",
  admin: "roleAdmin",
  member: "roleMember",
} as const;

/** 卡片壳（标题 + 内容 + 可选页脚说明），对齐原型 .card / .card-header。 */
function Card({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className={`${CARD_SHELL} px-4 py-4 min-[861px]:px-5`}>
      <h2 className="mb-4 text-[15px] font-bold leading-tight text-[var(--ink-900)]">
        {title}
      </h2>
      {children}
      {footer ? (
        <footer className="mt-4 border-t border-[var(--border-default)] pt-4 text-[12.5px] text-[var(--muted-foreground)]">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}

/** 状态 + 身份徽标组（身份头部与账号信息卡共用）。 */
export async function UserStatusBadges({ user }: { user: DetailUser }) {
  const t = await getTranslations("admin");

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {user.isDisabled ? (
        <Badge variant="neutral" className={`${BADGE_CLASS} ${BADGE_DISABLED}`}>
          {t("statusDisabled")}
        </Badge>
      ) : (
        <Badge variant="success" className={BADGE_CLASS}>
          {t("statusActive")}
        </Badge>
      )}
      {user.isAdmin ? (
        <Badge variant="neutral" className={`${BADGE_CLASS} ${BADGE_ADMIN}`}>
          {t("roleAdmin")}
        </Badge>
      ) : (
        <Badge variant="neutral" className={`${BADGE_CLASS} ${BADGE_MEMBER}`}>
          {t("roleUser")}
        </Badge>
      )}
    </span>
  );
}

/**
 * 用户身份头部（原型 .identity）：xl 头像（56px、12px 圆角）+ 昵称 + uid + 徽标。
 */
export async function UserIdentityHeader({ user }: { user: DetailUser }) {
  const name = displayName(user);

  return (
    <div className="mt-3 flex min-w-0 items-center gap-4">
      <UserAvatar
        userId={user.id}
        name={name}
        size={56}
        className="rounded-[var(--radius-12)]"
      />
      <div className="min-w-0">
        <h1 className="break-words text-[24px] font-bold leading-[1.15] tracking-[-0.01em] text-[var(--ink-900)]">
          {name}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13.5px] text-[var(--muted-foreground)]">
          <span className="font-mono text-[13px] font-semibold tracking-[0.02em] text-[var(--ink-500)]">
            {user.uid}
          </span>
          <UserStatusBadges user={user} />
        </div>
      </div>
    </div>
  );
}

/** 所属团队卡（原型 .member-row）：团队头像 + 名称 + 加入日期 + 角色徽标。 */
export async function TeamsCard({ teams }: { teams: DetailTeam[] }) {
  const [t, tTeams] = await Promise.all([
    getTranslations("admin"),
    getTranslations("teams"),
  ]);

  return (
    <Card title={t("detailTeamsTitle")}>
      {teams.length === 0 ? (
        <p className="py-3 text-[13px] text-[var(--ink-400)]">
          {t("detailTeamsEmpty")}
        </p>
      ) : (
        <div className="divide-y divide-[var(--border-default)]">
          {teams.map((team) => (
            <div key={team.id} className="flex items-center gap-3 py-[11px]">
              <UserAvatar userId={team.id} name={team.name} />
              <div className="min-w-0 flex-1 leading-[1.3]">
                <div className="truncate text-[13.5px] font-semibold text-[var(--ink-900)]">
                  {team.name}
                </div>
                <div className="text-[12px] text-[var(--muted-foreground)]">
                  {t("detailTeamJoined", {
                    date: formatTaskTimestamp(team.joinedAt).slice(0, 10),
                  })}
                </div>
              </div>
              <Badge
                variant={team.role === "member" ? "neutral" : "info"}
                className={BADGE_CLASS}
              >
                {tTeams(TEAM_ROLE_KEYS[team.role])}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * 最近会话卡（原型 .session-row）：时间 / IP / 客户端，只读展示。
 * 长 UA 截断显示，全文放在 title 上；无会话时给空态。
 */
export async function SessionsCard({ sessions }: { sessions: DetailSession[] }) {
  const t = await getTranslations("admin");

  return (
    <Card
      title={t("detailSessionsTitle")}
      footer={t("detailSessionsHint")}
    >
      {sessions.length === 0 ? (
        <p className="py-3 text-[13px] text-[var(--ink-400)]">
          {t("detailSessionsEmpty")}
        </p>
      ) : (
        <div className="divide-y divide-[var(--border-default)]">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center gap-3 py-3 text-[13px]"
            >
              <span className="w-[150px] shrink-0 text-[var(--muted-foreground)] [font-variant-numeric:tabular-nums]">
                {formatTaskTimestamp(session.createdAt)}
              </span>
              <span className="min-w-0 flex-1 break-words text-[var(--text-secondary)]">
                {session.ipAddress ?? "—"}
              </span>
              <span
                className="max-w-[220px] shrink-0 truncate text-[12px] text-[var(--ink-400)]"
                title={session.userAgent ?? undefined}
              >
                {session.userAgent ?? "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** 账号信息卡（原型 .meta-list）：UID / 邮箱 / 注册时间 / 注册码 / 状态。 */
export async function AccountCard({ user }: { user: DetailUser }) {
  const t = await getTranslations("admin");

  const rows: { key: string; label: string; value: ReactNode }[] = [
    {
      key: "uid",
      label: t("detailFieldUid"),
      value: (
        <span className="font-mono text-[13px] font-semibold tracking-[0.02em]">
          {user.uid}
        </span>
      ),
    },
    {
      key: "email",
      label: t("detailFieldEmail"),
      value: user.email ?? "—",
    },
    {
      key: "registeredAt",
      label: t("detailFieldRegisteredAt"),
      value: formatTaskTimestamp(user.createdAt),
    },
    {
      key: "regCode",
      label: t("detailFieldRegCode"),
      value: user.registrationCode ? (
        <code className="font-mono text-[13px] font-semibold tracking-[0.02em]">
          {user.registrationCode}
        </code>
      ) : (
        <span className="text-[var(--muted-foreground)]">
          {t("detailFieldRegCodeUnknown")}
        </span>
      ),
    },
    { key: "status", label: t("detailFieldStatus"), value: <UserStatusBadges user={user} /> },
  ];

  return (
    <Card title={t("detailAccountTitle")}>
      <div className="divide-y divide-[var(--border-default)]">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex items-center gap-3 py-[11px] text-[13px]"
          >
            <span className="w-16 shrink-0 text-[var(--muted-foreground)]">
              {row.label}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-2 font-medium text-[var(--ink-900)]">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * 当前管理员查看自己时的「管理操作」占位卡：只读提示，不渲染任何破坏性按钮。
 * 服务层的 selfOperation 仍是兜底。
 */
export async function SelfActionsCard() {
  const t = await getTranslations("admin");

  return (
    <Card title={t("detailActionsTitle")}>
      <p className="text-[12.5px] text-[var(--muted-foreground)]">
        {t("detailSelfHint")}
      </p>
    </Card>
  );
}

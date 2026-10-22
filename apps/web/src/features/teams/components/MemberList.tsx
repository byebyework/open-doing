import { Tag } from "antd";
import dayjs from "dayjs";

import { UserAvatar } from "@/components/ui/UserAvatar";

import type { MemberView } from "../service";

/** 角色 -> 展示文案与配色（对照原型角色 tag：owner/admin 用品牌色，member 用中性灰）。 */
const ROLE_LABELS: Record<MemberView["membership"]["role"], { label: string; color: string; background: string }> = {
  owner: { label: "所有者", color: "#7d2ae8", background: "rgba(125, 42, 232, 0.12)" },
  admin: { label: "管理员", color: "#7d2ae8", background: "rgba(125, 42, 232, 0.12)" },
  member: { label: "成员", color: "#5f6368", background: "#f1f3f4" },
};

/**
 * 团队成员只读列表（server 组件）。
 *
 * M1 仅展示；移除/转让等治理操作由 G 轨道在此追加。
 */
export function MemberList({ members }: { members: MemberView[] }) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="text-left text-[#9aa0a6]">
          <th className="pb-2 font-medium">成员</th>
          <th className="pb-2 font-medium">角色</th>
          <th className="pb-2 font-medium">加入时间</th>
        </tr>
      </thead>
      <tbody>
        {members.map(({ membership, user }) => {
          const role = ROLE_LABELS[membership.role];
          return (
            <tr key={membership.id} className="border-t border-[#eceef0]">
              <td className="py-2.5">
                <span className="flex items-center gap-2.5">
                  <UserAvatar username={user.username} />
                  <span className="font-medium text-[#0e1318]">{user.username}</span>
                  <span className="font-mono text-[12px] text-[#9aa0a6]">{user.uid}</span>
                </span>
              </td>
              <td className="py-2.5">
                <Tag style={{ color: role.color, background: role.background, border: "none", borderRadius: 999 }}>
                  {role.label}
                </Tag>
              </td>
              <td className="py-2.5 text-[#5f6368]">{dayjs(membership.joinedAt).format("MM-DD")}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

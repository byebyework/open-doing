import type { Metadata } from "next";
import Link from "next/link";

import { requireUser } from "@/features/auth/session";
import { JoinByCodeForm } from "@/features/teams/joins/components/JoinByCodeForm";

export const metadata: Metadata = {
  title: "凭码加入团队 · Open Doing",
};

/**
 * 凭码加入页：输入团队加入码发起申请，由 owner/admin 审批。
 *
 * `/teams/join` 是静态段，优先于 `/teams/[teamSlug]` 动态段，不会与团队 slug
 * 冲突；真正取团队按码查询在 server action 内完成。
 */
export default async function JoinTeamPage() {
  await requireUser();

  return (
    <div className="mx-auto w-full max-w-[820px] py-8">
      <h1 className="text-[22px] font-extrabold tracking-[-0.01em] text-[#0e1318]">凭码加入团队</h1>
      <p className="mb-8 mt-1.5 text-[14px] text-[#5f6368]">
        输入团队加入码，提交后由团队管理员审批。
      </p>

      <JoinByCodeForm />

      <p className="mt-8 text-[13px] text-[#5f6368]">
        不知道加入码？向团队管理员索取，或{" "}
        <Link href="/teams/new" className="font-semibold text-[#7d2ae8]">
          创建自己的团队
        </Link>
      </p>
    </div>
  );
}

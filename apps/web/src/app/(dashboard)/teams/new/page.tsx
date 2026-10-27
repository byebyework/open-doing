import type { Metadata } from "next";
import Link from "next/link";

import { requireUser } from "@/features/auth/session";
import { CreateTeamForm } from "@/features/teams/components/CreateTeamForm";

export const metadata: Metadata = {
  title: "创建团队 · Open Doing",
};

/** 创建团队页：成功后创建者自动成为 owner 并跳转团队设置。 */
export default async function CreateTeamPage() {
  await requireUser();

  return (
    <div className="mx-auto w-full max-w-[520px] py-10">
      <h1 className="text-[22px] font-extrabold tracking-[-0.01em] text-[#0e1318]">创建团队</h1>
      <p className="mb-8 mt-1.5 text-[14px] text-[#5f6368]">创建后你会自动成为团队所有者。</p>

      <CreateTeamForm />

      <p className="mt-8 text-center text-[13px] text-[#5f6368]">
        已有加入码？{" "}
        <Link href="/teams/join" className="font-semibold text-[#7d2ae8]">
          凭码加入
        </Link>
      </p>
    </div>
  );
}

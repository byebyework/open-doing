import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentUser } from "@/features/auth/session";

/**
 * 认证路由布局：左侧品牌渐变侧板 + 右侧居中表单区。
 *
 * 对照 docs/prototypes/login.html：桌面端双栏，≤860px 隐藏侧板，
 * 登录/注册页面（F-6）作为 children 渲染在右侧。
 * 已登录用户访问 /login、/register 时统一跳到 /my。
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (user) redirect("/my");

  return (
    <div className="grid min-h-screen grid-cols-1 bg-white min-[861px]:grid-cols-[1.05fr_1fr]">
      {/* 品牌侧板 */}
      <aside className="relative hidden flex-col overflow-hidden bg-[#1b0a3a] p-10 text-white min-[861px]:flex">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(520px 360px at 82% -5%, rgba(0,196,204,0.35), transparent 60%), radial-gradient(480px 420px at 8% 108%, rgba(125,42,232,0.55), transparent 62%)",
          }}
          aria-hidden="true"
        />

        <div className="relative flex items-center gap-2.5">
          <span className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-[linear-gradient(135deg,#7d2ae8_0%,#00c4cc_100%)] text-[16px] font-extrabold text-white">
            O
          </span>
          <span className="text-[15px] font-extrabold tracking-[-0.01em]">
            Open Doing
          </span>
        </div>

        <div className="relative my-auto max-w-[420px] py-10">
          <p className="text-[28px] font-extrabold leading-[1.3] tracking-[-0.01em]">
            让每个人的进展，
            <br />
            都被看见。
          </p>
          <p className="mt-4 text-[14px] text-white/70">
            个人任务、团队项目、进度概览，一处掌握。
          </p>
          <div className="mt-6 flex flex-col gap-3">
            {[
              "个人空间理清自己的待办",
              "团队项目进度实时同步",
              "项目健康度与成员负载一览",
            ].map((point) => (
              <div
                key={point}
                className="flex items-center gap-2.5 text-[14px] text-white/85"
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/15 text-[11px]">
                  ✓
                </span>
                {point}
              </div>
            ))}
          </div>
        </div>

        <div className="relative text-[12px] text-white/45">
          © 2026 Open Doing
        </div>
      </aside>

      {/* 表单区 */}
      <main className="grid min-h-screen min-w-0 place-items-center p-6">
        <div className="w-full max-w-[380px]">{children}</div>
      </main>
    </div>
  );
}

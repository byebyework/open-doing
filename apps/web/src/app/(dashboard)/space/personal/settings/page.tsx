import { Alert, Tag } from "antd";
import type { Metadata } from "next";

import { requireUser } from "@/features/auth/session";
import { ChangePasswordForm } from "@/features/users/components/ChangePasswordForm";
import { ReminderToggleList } from "@/features/users/components/ReminderToggleList";
import { getReminderPrefs } from "@/features/users/service";

export const metadata: Metadata = {
  title: "设置 · Open Doing",
};

/** 卡片外壳：与团队设置页保持一致的描边、圆角与阴影。 */
const CARD_CLASS =
  "rounded-xl border border-[#e1e3e6] bg-white p-5 shadow-[0_1px_3px_rgba(14,19,24,0.04)]";

/** 卡片头部：左侧标题、右侧说明（对照原型 `.card-header`）。 */
function SettingsCardHeader({
  title,
  caption,
}: {
  title: string;
  caption: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <h2 className="flex-1 text-[16px] font-semibold text-[#0e1318]">
        {title}
      </h2>
      <span className="text-right text-[12px] text-[#9aa0a6]">{caption}</span>
    </div>
  );
}

/**
 * 个人空间设置页（RSC）。
 *
 * 文案与版式对照 `docs/prototypes/space-settings-personal.html`：账户安全
 * （改密码）、任务提醒（临期 / 逾期开关，作用于 due-scan）、项目排序
 * （服务端按最近活动排序的静态说明）。交互下沉到 client 包装件。
 */
export default async function PersonalSettingsPage() {
  const user = await requireUser();
  const prefs = await getReminderPrefs(user.id);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[760px]">
      <header className="mb-6">
        <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[#0e1318]">
          设置
        </h1>
        <p className="mt-1.5 text-[13.5px] text-[#5f6368]">
          账户安全与个人偏好——改动即时生效，只影响你自己的空间视图。
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <section className={CARD_CLASS}>
          <SettingsCardHeader
            title="账户安全"
            caption="定期更换密码有助于保护账号安全。"
          />

          <ChangePasswordForm />
        </section>

        <section className={CARD_CLASS}>
          <SettingsCardHeader
            title="任务提醒"
            caption="评论、指派、邀请等协作通知不受影响"
          />
          <p className="-mt-2 mb-1 text-[12px] text-[#9aa0a6]">
            控制由系统每日扫描产生的到期提醒。
          </p>

          <ReminderToggleList prefs={prefs} />

          <Alert
            type="info"
            showIcon
            title="关闭后不再产生新的提醒通知；已经生成的通知仍会保留在通知中心。"
            className="mt-4"
          />
        </section>

        <section className={CARD_CLASS}>
          <SettingsCardHeader title="项目排序" caption="无需手动维护" />
          <p className="-mt-2 mb-1 text-[12px] text-[#9aa0a6]">
            个人空间的项目列表按最近活动排序。
          </p>

          <div className="flex items-center gap-4 py-[15px]">
            <div className="min-w-0 flex-1 leading-[1.45]">
              <div className="text-[13.5px] font-semibold text-[#0e1318]">
                按最近活动
              </div>
              <div className="mt-0.5 text-[12px] text-[#9aa0a6]">
                最近有任务动态的项目排在最前——正在推进的项目永远触手可及。
              </div>
            </div>
            <Tag
              className="flex-none"
              style={{
                margin: 0,
                color: "#0d99ff",
                background: "rgba(13, 153, 255, 0.1)",
                border: "none",
                borderRadius: 999,
              }}
            >
              当前规则
            </Tag>
          </div>

          <Alert
            type="info"
            showIcon
            title="排序应用于侧边栏空间切换器与个人 Dashboard 的项目列表。"
            className="mt-4"
          />
        </section>
      </div>
    </div>
  );
}

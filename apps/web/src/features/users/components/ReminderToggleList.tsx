"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/shadcn/switch";

import { updateReminderPrefsAction } from "../actions";
import type { ReminderPrefs } from "../service";

type ReminderKey = keyof ReminderPrefs;

export interface ReminderToggleListProps {
  /** 初始提醒偏好（RSC 传入，refreshed 后随服务端数据更新）。 */
  prefs: ReminderPrefs;
}

/**
 * 提醒开关列表（个人设置页客户端交互层）。
 *
 * 切换即时调用 Server Action：先乐观更新，失败回滚并 toast；成功静默，
 * `router.refresh()` 让 RSC 重新取数。`prefs` 与 `synced` 的渲染期同步
 * 建立在新对象身份上，保证刷新后的服务端值与本地 state 一致。
 */
export function ReminderToggleList({ prefs }: ReminderToggleListProps) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [current, setCurrent] = useState(prefs);
  const [synced, setSynced] = useState(prefs);
  const [saving, setSaving] = useState<ReminderKey | null>(null);

  // 渲染期同步 props → state：action 成功后 refresh 带来新的服务端值。
  if (prefs !== synced) {
    setSynced(prefs);
    setCurrent(prefs);
  }

  async function handleToggle(key: ReminderKey, nextEnabled: boolean) {
    const previous = current;
    setCurrent({ ...current, [key]: nextEnabled });
    setSaving(key);

    try {
      const result = await updateReminderPrefsAction(
        key === "dueSoonReminderEnabled"
          ? { dueSoonReminderEnabled: nextEnabled }
          : { overdueReminderEnabled: nextEnabled },
      );

      if (!result.ok) {
        toast.error(t("saveFailed"));
        setCurrent(previous);
        return;
      }

      // 成功静默（不 toast），刷新让服务端数据与本地 state 对齐。
      router.refresh();
    } catch {
      toast.error(t("saveFailed"));
      setCurrent(previous);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-4 py-[15px]">
        <div className="min-w-0 flex-1 leading-[1.45]">
          <div className="text-[13.5px] font-semibold text-[#0e1318]">
            {t("dueSoonReminder")}
          </div>
          <div className="mt-0.5 text-[12px] text-[#9aa0a6]">
            {t("dueSoonReminderDesc")}
          </div>
        </div>
        <Switch
          data-testid="settings-due-soon-switch"
          checked={current.dueSoonReminderEnabled}
          disabled={saving !== null}
          onCheckedChange={(checked) =>
            handleToggle("dueSoonReminderEnabled", checked)
          }
          aria-label={t("dueSoonReminder")}
        />
      </div>

      <div className="flex items-center gap-4 border-t border-[#e1e3e6] py-[15px]">
        <div className="min-w-0 flex-1 leading-[1.45]">
          <div className="text-[13.5px] font-semibold text-[#0e1318]">
            {t("overdueReminder")}
          </div>
          <div className="mt-0.5 text-[12px] text-[#9aa0a6]">
            {t("overdueReminderDesc")}
          </div>
        </div>
        <Switch
          data-testid="settings-overdue-switch"
          checked={current.overdueReminderEnabled}
          disabled={saving !== null}
          onCheckedChange={(checked) => handleToggle("overdueReminderEnabled", checked)}
          aria-label={t("overdueReminder")}
        />
      </div>
    </div>
  );
}

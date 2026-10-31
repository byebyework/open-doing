import type { Metadata } from "next";

import { parseAnalysisRange } from "@/features/analysis/buckets";
import { SpaceAnalysis } from "@/features/analysis/components/SpaceAnalysis";
import { getPersonalSpaceAnalysis } from "@/features/analysis/service";
import { requireUser } from "@/features/auth/session";
import { moduleHref } from "@/lib/routes";
import { todayInShanghai } from "@/lib/today";

export const metadata: Metadata = {
  title: "Analysis · Open Doing",
};

/**
 * 个人空间 Analysis（M5）。
 *
 * RSC 取数：`?range=7|30|90` 决定趋势窗口；缺失 / 非法 / 数组参数由
 * `parseAnalysisRange` 统一回退 30。统计卡恒为当前快照，不随范围变化。
 * 范围切换交互下沉到 client 组件，写回 URL。
 */
export default async function PersonalAnalysisPage(
  props: PageProps<"/space/personal/analysis">,
) {
  const user = await requireUser();
  const today = todayInShanghai();
  const { range: rangeParam } = await props.searchParams;
  const range = parseAnalysisRange(rangeParam);

  const personal = await getPersonalSpaceAnalysis(user.id, range, today);

  return (
    <SpaceAnalysis
      variant="personal"
      range={range}
      today={today}
      basePath={moduleHref("personal", "analysis")}
      spaceRef="personal"
      personal={personal}
      team={null}
    />
  );
}

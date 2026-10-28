import type { SpaceNavData } from "./SpaceNavData";
import { SpaceNavMenu } from "./SpaceNavMenu";

/**
 * 桌面侧栏空间导航（server 包装件）。
 *
 * 只把布局层取好的可序列化数据交给 `SpaceNavMenu`（client，负责路由高亮），
 * 保持 server / client 边界显式：布局不直接 import client 组件。
 */
export async function SpaceNav({ data }: { data: SpaceNavData }) {
  return <SpaceNavMenu data={data} />;
}

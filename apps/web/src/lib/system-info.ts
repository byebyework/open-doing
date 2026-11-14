import pkg from "../../package.json";

/**
 * 系统信息（关于系统页 /about 的数据源，server-only）。
 *
 * - 应用版本：apps/web/package.json 的 version（构建期随模块打包）；
 * - 构建元数据：GIT_COMMIT_SHA / BUILD_TIME 在镜像构建时由 Dockerfile
 *   的 ARG→ENV 注入，Next 在构建期内联进服务端代码；本地 dev 缺失时
 *   为 null，页面上显示「未知（开发模式）」；
 * - 运行时数据：Node 版本（process.version）、进程运行时长（process.uptime）。
 */

export const APP_VERSION: string = pkg.version;

export interface BuildInfo {
  commit: string | null;
  buildTime: string | null;
}

/** 从环境变量解析构建元数据；空/缺失一律归一化为 null（纯函数，便于测试）。 */
export function resolveBuildInfo(env: Record<string, string | undefined>): BuildInfo {
  const commit = env.GIT_COMMIT_SHA?.trim() || null;
  const buildTime = env.BUILD_TIME?.trim() || null;
  return { commit, buildTime };
}

/** 按天/小时/分钟拆分运行时长，取最大的两个非零单位（纯函数，便于测试）。 */
export interface UptimeParts {
  days: number | null;
  hours: number | null;
  minutes: number | null;
}

export function splitUptime(totalSeconds: number): UptimeParts {
  if (totalSeconds < 60) return { days: null, hours: null, minutes: null };

  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return { days: null, hours: null, minutes };

  const totalHours = Math.floor(minutes / 60);
  if (totalHours < 24) return { days: null, hours: totalHours, minutes: minutes % 60 };

  return { days: Math.floor(totalHours / 24), hours: totalHours % 24, minutes: null };
}

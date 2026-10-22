"use client";

import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import type { ReactNode } from "react";

import { antdTheme } from "./theme";

// 全站统一使用中文日期格式（DatePicker 等 antd 日期组件依赖 dayjs locale）
dayjs.locale("zh-cn");

/**
 * 根布局专用包裹：收集 antd 服务端样式并下发主题与中文 locale。
 * F-5 起所有页面经此获得主题，不得再自建 ConfigProvider。
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <AntdRegistry>
      <ConfigProvider locale={zhCN} theme={antdTheme}>
        {children}
      </ConfigProvider>
    </AntdRegistry>
  );
}

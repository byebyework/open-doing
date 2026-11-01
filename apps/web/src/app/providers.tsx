"use client";

import { AntdRegistry } from "@ant-design/nextjs-registry";
import { App as AntApp, ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/en";
import "dayjs/locale/zh-cn";
import type { ReactNode } from "react";

import type { AppLocale } from "@/i18n/config";

import { antdTheme } from "./theme";

const ANTD_LOCALE = { zh: zhCN, en: enUS } as const;
const DAYJS_NAME = { zh: "zh-cn", en: "en" } as const;

/** Providers 入口参数。 */
export interface ProvidersProps {
  children: ReactNode;
  /** 请求级 locale(根布局从 i18n/server 解析后传入)。 */
  locale: AppLocale;
}

/**
 * 根布局专用包裹：收集 antd 服务端样式并下发主题与请求级 locale。
 * F-5 起所有页面经此获得主题，不得再自建 ConfigProvider。
 * locale 决定 antd 组件文案与 dayjs 日期文案（与 RSC 渲染同源，防 hydration 不一致）。
 * antd App（component=false，不渲染包裹 DOM）为 message 等提供主题上下文，
 * 组件内一律 `App.useApp()` 取 message，禁止静态 `message.xxx`（会告警且丢主题）。
 */
export function Providers({ children, locale }: ProvidersProps) {
  dayjs.locale(DAYJS_NAME[locale]);

  return (
    <AntdRegistry>
      <ConfigProvider locale={ANTD_LOCALE[locale]} theme={antdTheme}>
        <AntApp component={false}>{children}</AntApp>
      </ConfigProvider>
    </AntdRegistry>
  );
}

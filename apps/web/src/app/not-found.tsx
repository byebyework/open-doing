"use client";

import { Button, Result } from "antd";
import { useTranslations } from "next-intl";

/**
 * 全局 404 页面（antd Result 风格）。
 *
 * 根布局下的未命中路由与 `notFound()` 均渲染此页；
 * 不在 dashboard 外壳内，避免 404 时出现侧栏上下文。
 */
export default function NotFound() {
  const t = useTranslations("notFound");
  return (
    <div className="grid min-h-screen place-items-center bg-[#f4f5f7] p-6">
      <Result
        status="404"
        title={t("title")}
        subTitle={
          <span data-testid="not-found-message">{t("message")}</span>
        }
        extra={
          <Button type="primary" href="/">
            {t("backHome")}
          </Button>
        }
      />
    </div>
  );
}

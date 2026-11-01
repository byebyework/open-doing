import type { Metadata } from "next";
import type { ReactNode } from "react";

import { LOCALE_HTML_LANG } from "@/i18n/config";
import { getRequestLocale } from "@/i18n/server";

import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Open Doing",
  description: "Open Doing 任务与项目管理平台",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const locale = await getRequestLocale();

  return (
    <html lang={LOCALE_HTML_LANG[locale]} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}

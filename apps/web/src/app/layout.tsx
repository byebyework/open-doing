import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";

import { LOCALE_HTML_LANG } from "@/i18n/config";
import { getRequestLocale } from "@/i18n/server";

import { Providers } from "./providers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");

  return { title: t("appTitle"), description: t("appDescription") };
}

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const locale = await getRequestLocale();

  return (
    <html lang={LOCALE_HTML_LANG[locale]} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>
          <Providers locale={locale}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

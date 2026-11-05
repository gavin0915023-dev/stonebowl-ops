import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "石小满 · 门店工作台",
  description: "每一份热饭，都有条不紊。石锅拌饭门店订单与厨房出餐工作台。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}

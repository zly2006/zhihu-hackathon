import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "知乎er的重启人生",
  description: "在上万段真实人生经历里，重走一次你的选择。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { Silkscreen, Space_Grotesk } from "next/font/google";
import "./globals.css";
import "./logo-concept.css";

const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"] });
const silkscreen = Silkscreen({ variable: "--font-silkscreen", subsets: ["latin"], weight: ["400"] });
const localOrigin = new URL("http://localhost:3000");

export const metadata: Metadata = {
    metadataBase: localOrigin,
    title: "면접용 로컬 챗 v1 — LUNA",
    description: "각 사용자의 ChatGPT 계정으로 연결되는 로컬 전용 LUNA 챗봇.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "면접용 로컬 챗 v1 — LUNA",
      description: "Ask anything. Think spatially.",
      images: [{ url: new URL("/og.png", localOrigin).toString(), width: 1200, height: 630, alt: "LUNA Voxel Chat" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "면접용 로컬 챗 v1 — LUNA",
      description: "Ask anything. Think spatially.",
      images: [new URL("/og.png", localOrigin).toString()],
    },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={`${spaceGrotesk.variable} ${silkscreen.variable}`}>{children}</body>
    </html>
  );
}

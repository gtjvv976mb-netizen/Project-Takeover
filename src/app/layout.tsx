import type { Metadata } from "next";
import { Anton, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { appConfig } from "@/lib/solana";
import { WalletProviders } from "@/components/WalletProviders";
import { ConfigProvider } from "@/components/ConfigContext";
import { Nav } from "@/components/Nav";
import { SiteFooter } from "@/components/SiteFooter";

const display = Anton({ subsets: ["latin"], weight: ["400"], variable: "--font-anton", display: "swap" });
const ui = Inter_Tight({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-ui", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono-face", display: "swap" });

export const metadata: Metadata = {
  title: "Project: Takeover — buy and sell what independent devs built on Solana",
  description:
    "An escrowed marketplace for Solana projects. Token authorities, pump.fun coin ownership, whole projects and communities. The chain proves who owns it before anyone pays.",
};
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const config = appConfig();
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased">
        <ConfigProvider config={config}>
          <WalletProviders rpcUrl={config.rpcUrl}>
            <Nav />
            <main className="relative z-[2]">{children}</main>
            <SiteFooter config={config} />
          </WalletProviders>
        </ConfigProvider>
      </body>
    </html>
  );
}

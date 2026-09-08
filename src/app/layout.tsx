import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", weight: ["400", "500", "600", "700"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-face", weight: ["400", "500"] });
import "./globals.css";
import { appConfig } from "@/lib/solana";
import { WalletProviders } from "@/components/WalletProviders";
import { ConfigProvider } from "@/components/ConfigContext";
import { Nav } from "@/components/Nav";
import { CursorGlow } from "@/components/CursorGlow";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Project: Takeover — the harbour where Solana projects change hands",
  description: "Escrowed marketplace for token authorities, pump.fun coin ownership, sites and communities on Solana.",
};
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const config = appConfig();
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased">
        <ConfigProvider config={config}>
          <WalletProviders rpcUrl={config.rpcUrl}>
            <CursorGlow />
            <Nav />
            <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
            <SiteFooter config={config} />
          </WalletProviders>
        </ConfigProvider>
      </body>
    </html>
  );
}

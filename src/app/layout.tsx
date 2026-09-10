import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { appConfig } from "@/lib/solana";
import { WalletProviders } from "@/components/WalletProviders";
import { ConfigProvider } from "@/components/ConfigContext";
import { Nav } from "@/components/Nav";
import { SiteFooter } from "@/components/SiteFooter";
import { THEME_SCRIPT } from "@/components/ThemeToggle";

const display = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display-face", display: "swap" });
const ui = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-ui", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono-face", display: "swap" });

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF9FE" },
    { media: "(prefers-color-scheme: dark)", color: "#0F0D24" },
  ],
};

export const metadata: Metadata = {
  title: "Project: Takeover — buy and sell what independent devs built on Solana",
  description:
    "An escrowed marketplace for Solana projects. Token authorities, pump.fun coin ownership, whole projects and communities. The chain proves who owns it before anyone pays.",
};
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const config = appConfig();
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* Stamps data-theme before the body paints. Any later and dark-mode visitors
            get a white flash on every navigation. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <ConfigProvider config={config}>
          <WalletProviders rpcUrl={config.rpcUrl}>
            <Nav />
            <main>{children}</main>
            <SiteFooter config={config} />
          </WalletProviders>
        </ConfigProvider>
      </body>
    </html>
  );
}

"use client";
import { useEffect, useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { resolveRpcUrl } from "./ConfigContext";
import { registerPhantomDeeplinkWallet } from "@/lib/client/phantom-deeplink";
import type { Cluster } from "@/lib/client/phantom-deeplink-core";

// Wallet Standard wallets (Phantom, Solflare, Backpack, ...) register themselves; no adapters needed.
export function WalletProviders({ children, rpcUrl, network }: { children: ReactNode; rpcUrl: string; network: Cluster }) {
  const wallets = useMemo(() => [], []);
  const endpoint = useMemo(() => resolveRpcUrl(rpcUrl), [rpcUrl]);
  /**
   * The endpoint is an HTTP route on our own origin, so there is no websocket beside it
   * to derive. Left alone, web3.js would guess `wss://…/api/rpc` and quietly retry a
   * connection that can never open. Nothing here subscribes — confirmation polls instead,
   * see `sendAndConfirm` in lib/client/program.ts — so point it at a host that will
   * refuse fast rather than one that does not exist.
   */
  const config = useMemo(() => ({ commitment: "confirmed" as const, disableRetryOnRateLimit: false }), []);
  // On a phone browser no wallet registers itself, so the site offers Phantom by deep link.
  useEffect(() => { registerPhantomDeeplinkWallet(network); }, [network]);
  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

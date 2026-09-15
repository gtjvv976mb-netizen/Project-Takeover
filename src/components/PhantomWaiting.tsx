"use client";
import { useSyncExternalStore } from "react";
import { cancelPending, getPending, reopenPending, subscribePending } from "@/lib/client/phantom-deeplink";
import { Button } from "@/components/ui";

/**
 * Shown in the tab that asked Phantom for something, until the answer arrives.
 *
 * The person is about to leave for another app and come back through a different tab,
 * and nothing on the phone tells them the original one is still waiting. This does.
 */
export function PhantomWaiting() {
  const pending = useSyncExternalStore(subscribePending, getPending, () => null);
  if (!pending) return null;
  const ask = pending.method === "connect" ? "Approve the connection in Phantom" : "Approve it in Phantom";
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="phantom-waiting-title"
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/55 p-4 sm:items-center">
      <div className="card w-full max-w-sm space-y-4 p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" />
          <h2 id="phantom-waiting-title" className="text-lg font-bold text-ink">Waiting for Phantom</h2>
        </div>
        <p className="text-[14px] leading-relaxed text-muted">
          {ask}, then come back to <strong className="text-ink">this tab</strong>. It finishes from here; the tab Phantom opens can be closed.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={reopenPending}>Open Phantom again</Button>
          <Button variant="secondary" onClick={cancelPending}>Cancel</Button>
        </div>
        <p className="text-[12px] text-muted">
          Phantom did not open? <a className="underline underline-offset-2" href="https://phantom.app/download" target="_blank" rel="noreferrer">Install it</a>, then try again.
        </p>
      </div>
    </div>
  );
}

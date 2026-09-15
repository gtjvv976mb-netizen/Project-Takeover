"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { completeReturn, returnPicked, type ReturnOutcome } from "@/lib/client/phantom-deeplink";

/**
 * Where Phantom sends the phone back to.
 *
 * On iOS this opens as a new Safari tab, so the page that asked is somewhere behind it,
 * still waiting. The reply is decrypted and filed for that tab in `completeReturn`; what
 * remains is to tell the person where to go. For a connection there is nothing to hand
 * back, so this tab simply becomes the site, signed in, and goes where they were.
 */
export default function PhantomReturnPage() {
  const { id } = useParams<{ id: string }>();
  const [out, setOut] = useState<ReturnOutcome | null>(null);
  const [picked, setPicked] = useState(false);

  useEffect(() => {
    if (!id) return;
    const o = completeReturn(id, new URLSearchParams(window.location.search));
    // Strip the reply from the address bar: a reload must not reprocess it, and a
    // signature has no business in the history list.
    window.history.replaceState(null, "", window.location.pathname);
    // The reply lives in this tab's URL, which exists only on the client; the server
    // renders the "working" state and this decides the rest.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOut(o);
    if (o.kind === "connected") { window.location.replace(o.back); return; }
    if (o.kind !== "signed") return;
    const t = setInterval(() => { if (returnPicked(id)) { setPicked(true); clearInterval(t); } }, 800);
    return () => clearInterval(t);
  }, [id]);

  const back = out && "back" in out ? out.back : "/";

  return (
    <div className="wrap max-w-md py-12">
      {(!out || out.kind === "connected") && (
        <>
          <h1 className="text-2xl font-bold text-ink">{out ? "Connected" : "Reading Phantom's reply…"}</h1>
          <p className="mt-2 text-muted">{out ? "Taking you back to where you were." : "One moment."}</p>
        </>
      )}
      {out?.kind === "signed" && (
        <>
          <div className="kicker mb-2" style={{ color: "var(--color-green)" }}>Signed in Phantom</div>
          <h1 className="text-2xl font-bold text-ink">Now switch back to the tab you came from.</h1>
          <p className="mt-3 leading-relaxed text-muted">
            The Project: Takeover tab that opened Phantom is still waiting and finishes the job the moment you return to it.
            Use the tab switcher; this tab can be closed.
          </p>
          <p className="mt-4 rounded-lg border border-line px-3 py-2 text-[14px]" style={{ background: "var(--color-tint-base)" }}>
            {picked ? "✓ That tab has picked it up." : "Waiting for that tab to notice — it will when you switch to it."}
          </p>
          <p className="mt-6 text-[13px] text-muted">
            Lost that tab? Nothing was sent to the network. Go back to <Link href={back} className="underline underline-offset-2">where you were</Link> and try again.
          </p>
        </>
      )}
      {out?.kind === "error" && (
        <>
          <h1 className="text-2xl font-bold text-ink">Not signed</h1>
          <p className="mt-2 text-muted">{out.message}</p>
          <p className="mt-6 text-[14px]"><Link href={back} className="underline underline-offset-2">Back to where you were</Link></p>
        </>
      )}
      {out?.kind === "expired" && (
        <>
          <h1 className="text-2xl font-bold text-ink">This link has expired</h1>
          <p className="mt-2 text-muted">It does not match a request from this browser, or the request is more than ten minutes old. Nothing was sent.</p>
          <p className="mt-6 text-[14px]"><Link href="/" className="underline underline-offset-2">Home</Link></p>
        </>
      )}
    </div>
  );
}

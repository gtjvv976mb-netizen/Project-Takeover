"use client";
import { use, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { signedPost } from "@/lib/client/api";
import { shortKey, type BuilderProfile, type BuilderStats, type Listing } from "@/lib/types";
import { Alert, Button, Field, inputCls, ListingCard } from "@/components/ui";
import { StatTiles } from "@/components/Builder";
import { explorerUrl, useConfig } from "@/components/ConfigContext";

type Data = { wallet: string; profile: BuilderProfile | null; stats: BuilderStats; listings: Listing[] };

export default function BuilderPage({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = use(params);
  const w = useWallet();
  const cfg = useConfig();
  const me = w.publicKey?.toBase58();
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", bio: "", github: "", x: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/builders/${wallet}`).then((r) => r.json()).then((d: Data) => {
      if (cancelled) return;
      setData(d);
      if (d.profile) setForm({ name: d.profile.name, bio: d.profile.bio, github: d.profile.github, x: d.profile.x, website: d.profile.website });
    });
    return () => { cancelled = true; };
  }, [wallet]);

  async function save() {
    setBusy(true); setError(null);
    try {
      const r = await signedPost<{ profile: BuilderProfile }>(w, `/api/builders/${wallet}`, "profile", null, form);
      setData((d) => d && { ...d, profile: r.profile });
      setEditing(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (!data) return <p className="wrap py-10 text-muted">Loading builder…</p>;
  const p = data.profile;
  const links = [p?.github && { label: "GitHub", href: p.github }, p?.x && { label: "X", href: p.x }, p?.website && { label: "Website", href: p.website }].filter(Boolean) as { label: string; href: string }[];
  const active = data.listings.filter((l) => l.status === "active");
  const past = data.listings.filter((l) => l.status !== "active");

  return (
    <div className="wrap py-10 space-y-10">
      <header className="flex flex-wrap items-start gap-5">
        <div className="flex h-20 w-20 items-center justify-center border border-line bg-bg-2"><span className="h-6 w-6 rotate-45 bg-brand" /></div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{p?.name || "Unnamed builder"}</h1>
          <a className="font-mono text-xs text-faint hover:text-ink" href={explorerUrl(cfg, "address", wallet)} target="_blank" rel="noreferrer">{shortKey(wallet, 8)}</a>
          {p?.bio && <p className="mt-2 max-w-2xl whitespace-pre-wrap text-ink">{p.bio}</p>}
          {links.length > 0 && (
            <div className="mt-3 flex gap-2">{links.map((l) => <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className=" border border-line px-3 py-1 text-xs hover:border-lime/60">{l.label} ↗</a>)}</div>
          )}
        </div>
        {me === wallet && <Button variant="secondary" onClick={() => setEditing((v) => !v)}>{editing ? "Close" : p ? "Edit profile" : "Set up your builder profile"}</Button>}
      </header>

      {editing && (
        <section className="grid gap-3 border border-line bg-bg-2 p-5 sm:grid-cols-2">
          <Field label="Name"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} /></Field>
          <Field label="Website"><input className={inputCls} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://" /></Field>
          <Field label="GitHub"><input className={inputCls} value={form.github} onChange={(e) => setForm({ ...form, github: e.target.value })} placeholder="https://github.com/you" /></Field>
          <Field label="X"><input className={inputCls} value={form.x} onChange={(e) => setForm({ ...form, x: e.target.value })} placeholder="https://x.com/you" /></Field>
          <div className="sm:col-span-2"><Field label="Bio" hint="What you build, what you've shipped, what you're looking for."><textarea className={inputCls} rows={4} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={600} /></Field></div>
          {error && <div className="sm:col-span-2"><Alert kind="error">{error}</Alert></div>}
          <div className="sm:col-span-2"><Button onClick={save} disabled={busy}>{busy ? "Signing…" : "Save profile"}</Button></div>
        </section>
      )}

      <StatTiles stats={data.stats} />

      <section>
        <h2 className="mb-3 text-lg font-semibold">On the market ({active.length})</h2>
        {active.length ? <div className="grid gap-4 md:grid-cols-2">{active.map((l) => <ListingCard key={l.id} l={l} />)}</div> : <p className="text-faint">Nothing listed right now.</p>}
      </section>
      {past.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Track record ({past.length})</h2>
          <div className="grid gap-4 md:grid-cols-2">{past.map((l) => <ListingCard key={l.id} l={l} />)}</div>
        </section>
      )}
    </div>
  );
}

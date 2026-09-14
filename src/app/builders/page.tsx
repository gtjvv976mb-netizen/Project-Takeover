"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Chip, inputCls, Sigil } from "@/components/ui";
import { formatSol, shortKey, type BuilderCard } from "@/lib/types";

export default function BuildersPage() {
  const [rows, setRows] = useState<BuilderCard[] | null>(null);
  const [openOnly, setOpenOnly] = useState(false);
  const [skill, setSkill] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    let off = false;
    const p = new URLSearchParams();
    if (openOnly) p.set("open", "1");
    if (skill) p.set("skill", skill);
    fetch(`/api/builders?${p}`).then((r) => r.json())
      .then((b) => { if (!off) setRows(Array.isArray(b) ? b : []); })
      .catch(() => { if (!off) setRows([]); });
    return () => { off = true; };
  }, [openOnly, skill]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !rows) return rows;
    return rows.filter((b) =>
      `${b.profile?.name ?? ""} ${b.profile?.bio ?? ""} ${(b.profile?.skills ?? []).join(" ")} ${b.wallet}`
        .toLowerCase().includes(needle));
  }, [rows, q]);

  /** Every skill anyone has claimed, most common first, for the filter row. */
  const skills = useMemo(() => {
    const count = new Map<string, number>();
    for (const b of rows ?? []) for (const s of b.profile?.skills ?? []) count.set(s, (count.get(s) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([s]) => s);
  }, [rows]);

  return (
    <div className="wrap space-y-8 py-10">
      <header>
        <h1 className="title-lg">Builders</h1>
        <p className="lead mt-2">
          Everyone who has shipped, sold or answered something here. Delivered work and
          conversation are counted separately, on purpose — one is proof, the other is presence.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <input className={`${inputCls} max-w-xs`} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search names, skills, bios…" aria-label="Search builders" />
        <label className="flex cursor-pointer items-center gap-2 text-[14px] text-muted">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          Open to work
        </label>
        {skill && (
          <button className="pill" onClick={() => setSkill("")} style={{ ["--tint" as string]: "var(--color-violet)" }}>
            {skill} ✕
          </button>
        )}
      </div>

      {skills.length > 0 && !skill && (
        <div className="flex flex-wrap gap-1.5">
          {skills.map((s) => (
            <button key={s} onClick={() => setSkill(s)} className="pill" style={{ ["--tint" as string]: "var(--color-muted)" }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {shown === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-44" />)}</div>
      ) : shown.length === 0 ? (
        <Alert kind="info">
          Nobody matches that yet. As people list projects, win commissions and post, they appear here
          automatically — there is no sign-up.
        </Alert>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((b) => (
            <Link key={b.wallet} href={`/builders/${b.wallet}`} className="card card-hover flex flex-col gap-3 p-5">
              <div className="flex items-center gap-3">
                <Sigil wallet={b.wallet} size={42} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold text-ink">{b.profile?.name || shortKey(b.wallet, 4)}</div>
                  {b.profile?.openToWork && <span className="text-[12.5px] font-semibold" style={{ color: "var(--color-green)" }}>Open to work</span>}
                </div>
              </div>

              {b.profile?.bio && <p className="clamp-2 text-[14px] leading-relaxed text-muted">{b.profile.bio}</p>}

              {(b.profile?.skills ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {b.profile!.skills.slice(0, 5).map((s) => <Chip key={s}>{s}</Chip>)}
                </div>
              )}

              {/* Two rows, never one number: what they finished, then how present they are. */}
              <div className="mt-auto space-y-1.5 border-t border-line pt-3 text-[13px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted">Delivered</span>
                  <span className="font-semibold text-ink">
                    {b.stats.sold} sold{b.commissions > 0 && ` · ${b.commissions} commissioned`}
                    {b.stats.earnedLamports > 0 && ` · ${formatSol(b.stats.earnedLamports, 1)} SOL`}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-faint">On the board</span>
                  <span className="text-faint">{b.posts} posts · {b.forumScore} score</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

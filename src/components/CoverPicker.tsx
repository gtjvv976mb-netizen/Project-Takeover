"use client";
import { useRef, useState } from "react";
import { ACCEPT_ATTR } from "@/lib/uploads-shared";

/**
 * The control that gets a picture out of a seller.
 *
 * It is a drop target as well as a file input, shows the picture at the shape it will
 * actually be shown at, and says what is wrong in place rather than in an alert somewhere
 * else on the page. Listings used to go up with no cover because the upload was a small
 * grey input buried at the bottom of a sidebar; this is deliberately the opposite.
 */
export function CoverPicker({
  preview,
  onPick,
  onClear,
  busy = false,
  error = null,
  note = null,
  aspect = "aspect-[21/9]",
  label = "Cover image",
}: {
  /** URL of the picture as it stands — a blob: URL while uploading, then the stored one. */
  preview: string | null;
  onPick: (file: File) => void;
  onClear?: () => void;
  busy?: boolean;
  /**
   * Why the last attempt failed. Shown here rather than wherever the page keeps its
   * errors: a seller who has just clicked this box is looking at this box, and an
   * explanation somewhere further down the page reads as nothing having happened.
   */
  error?: string | null;
  /** What was done to the picture on the way, when it was not sent untouched. */
  note?: string | null;
  aspect?: string;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div>
      <div
        className={`relative w-full overflow-hidden rounded-2xl border-2 border-dashed transition-colors ${aspect}`}
        style={{
          borderColor: error ? "var(--color-rose)" : over ? "var(--color-brand)" : preview ? "var(--color-line)" : "color-mix(in srgb, var(--color-brand) 40%, var(--color-line))",
          background: over ? "color-mix(in srgb, var(--color-brand) 8%, var(--color-tint-base))" : "var(--color-bg-2)",
        }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onPick(f);
        }}
      >
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}

        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="absolute inset-0 grid place-items-center text-center transition-colors disabled:cursor-wait"
          style={preview ? { background: "transparent" } : undefined}
        >
          {preview ? (
            <span
              className="rounded-full px-4 py-2 text-[13.5px] font-semibold opacity-0 transition-opacity hover:opacity-100"
              style={{ background: "color-mix(in srgb, var(--color-bg) 82%, transparent)", color: "var(--color-ink)" }}
            >
              {busy ? "Uploading…" : "Replace image"}
            </span>
          ) : (
            <span className="px-6">
              <span className="block text-[15px] font-bold text-ink">{busy ? "Uploading…" : `Add a ${label.toLowerCase()}`}</span>
              <span className="mt-1 block text-[13px] text-muted">
                Drop a file here or click to choose · PNG, JPEG, WebP or GIF · up to 2&nbsp;MB
              </span>
            </span>
          )}
        </button>

        <input
          ref={input}
          type="file"
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = ""; // so picking the same file twice still fires
            if (f) onPick(f);
          }}
        />
      </div>

      {error && (
        <p className="mt-2 text-[13px] font-semibold" style={{ color: "var(--color-rose)" }} role="alert">{error}</p>
      )}
      {!error && note && <p className="mt-2 text-[13px] text-faint">{note}</p>}

      {preview && onClear && (
        <button type="button" onClick={onClear} disabled={busy}
          className="mt-2 text-[13px] text-muted underline underline-offset-2 hover:text-ink disabled:opacity-50">
          Remove image
        </button>
      )}
    </div>
  );
}

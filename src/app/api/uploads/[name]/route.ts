import { mimeForName, readImage } from "@/lib/uploads";

/**
 * Serve a stored banner.
 *
 * The content type comes from the stored file's extension, which was decided by reading
 * the bytes at upload time — never from anything a request carries. `nosniff` stops a
 * browser second-guessing that, and the sandbox CSP means that even if a file somehow
 * reached disk with active content in it, nothing in it can run against this origin.
 *
 * Names are the SHA-256 of the contents, so a name can only ever refer to one picture:
 * safe to cache forever.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const mime = mimeForName(name);
  const bytes = mime ? readImage(name) : null;
  if (!bytes || !mime) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

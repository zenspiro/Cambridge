import { adminSession } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { figurePageSvg, PAPER_KINDS, paperDoc } from "@/lib/brain/paperRead";
import type { PaperKind } from "@/lib/brain/paper";

// A figure's whole page as SVG with its current box framed, for drawing the box by hand on the review screen. Built
// from the stored, checked page drawing (figures.ts); admin only, not cached, nothing may be loaded from it.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; fig: string }> }) {
  const session = await adminSession();
  if (!session) return new Response("Not found", { status: 404 });
  const { id, fig } = await params;
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(id) || !/^[A-Za-z0-9_.-]{1,20}$/.test(fig)) return new Response("Not found", { status: 404 });
  const env = await getEnv();
  const doc = await paperDoc(env.DB, id);
  const svg = doc && PAPER_KINDS.includes(doc.docType as PaperKind) ? await figurePageSvg(env.FILES, id, doc.docType as PaperKind, fig) : null;
  if (!svg) return new Response("Not found", { status: 404 });
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

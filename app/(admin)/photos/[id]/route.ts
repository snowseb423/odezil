import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { PHOTO_BUCKET } from "@/lib/delivery-input";

const SIGNED_URL_SECONDS = 60;

/**
 * Photo d'un bon : vérifie l'admin, lit le chemin sous RLS puis redirige vers
 * une URL signée valable 60 s (le bucket est privé).
 */
export async function GET(_request: NextRequest, { params }: RouteContext<"/photos/[id]">) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) {
    return new NextResponse("Introuvable", { status: 404 });
  }

  const { data: delivery } = await supabase.from("deliveries").select("photo_path").eq("id", parsedId.data).maybeSingle();
  if (!delivery?.photo_path) {
    return new NextResponse("Introuvable", { status: 404 });
  }

  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(delivery.photo_path, SIGNED_URL_SECONDS);
  if (error || !data) {
    return new NextResponse("Introuvable", { status: 404 });
  }

  const response = NextResponse.redirect(data.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase)
    return NextResponse.json(
      {
        error:
          "Restaurant verification is not available yet. Please wait until Hseb Please is connected to its restaurant directory.",
        setupRequired: true,
      },
      { status: 503 },
    );
  const slug = request.nextUrl.searchParams.get("slug");
  const search = request.nextUrl.searchParams.get("q")?.trim().slice(0, 120);
  let query = supabase
    .from("restaurants")
    .select(
      "id,slug,name,city,status,splitting_enabled,split_access_expires_at",
    )
    .order("name")
    .limit(30);
  if (slug) query = query.eq("slug", slug.slice(0, 150));
  else if (search)
    query = query.ilike("name", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
  const { data, error } = await query;
  if (error)
    return NextResponse.json(
      {
        error:
          "We couldn’t check the restaurant directory. Please try again shortly.",
      },
      { status: 503 },
    );
  return NextResponse.json(
    { restaurants: data },
    { headers: { "Cache-Control": "no-store" } },
  );
}

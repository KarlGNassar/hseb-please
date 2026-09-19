import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { isBill, splitBill } from "@/lib/bill";
import { requiresRegisteredRestaurant } from "@/lib/access-policy";

export async function POST(request: NextRequest) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 200_000)
    return NextResponse.json(
      { error: "This bill is too large." },
      { status: 413 },
    );
  const text = await request.text();
  if (text.length > 200_000)
    return NextResponse.json(
      { error: "This bill is too large." },
      { status: 413 },
    );
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid bill." }, { status: 400 });
  }
  if (
    !body ||
    !isBill(body.bill) ||
    !body.bill.people.length ||
    !body.bill.items.length ||
    body.bill.people.some((p: { name: string }) => !p.name.trim()) ||
    body.bill.items.some((i: { name: string }) => !i.name.trim())
  ) {
    return NextResponse.json(
      {
        error:
          "Add at least one person and a valid bill item, with names for each.",
      },
      { status: 400 },
    );
  }
  if (requiresRegisteredRestaurant()) {
    if (
      typeof body.restaurantId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        body.restaurantId,
      )
    ) {
      return NextResponse.json(
        { error: "Please select a registered restaurant before splitting." },
        { status: 403 },
      );
    }
    const supabase = getSupabase();
    if (!supabase)
      return NextResponse.json(
        {
          error:
            "Restaurant verification is unavailable. Please try again later.",
        },
        { status: 503 },
      );
    const { data: allowed, error } = await supabase.rpc(
      "restaurant_can_split",
      { restaurant_id: body.restaurantId },
    );
    if (error)
      return NextResponse.json(
        {
          error:
            "We couldn’t verify this restaurant. Please try again shortly.",
        },
        { status: 503 },
      );
    if (allowed !== true)
      return NextResponse.json(
        {
          error:
            "Splitting is not available for this restaurant yet. Please wait for the restaurant to register and activate Hseb Please.",
        },
        { status: 403 },
      );
  }
  if (
    body.bill.mode === "items" &&
    body.bill.items.some(
      (item: { personIds: string[] }) =>
        !body.bill.people.some((p: { id: string }) =>
          item.personIds.includes(p.id),
        ),
    )
  ) {
    return NextResponse.json(
      { error: "Assign every item to at least one person before splitting." },
      { status: 400 },
    );
  }
  return NextResponse.json(
    { split: splitBill(body.bill) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

import { ocrSpace, type OcrSpaceOptions } from "ocr-space-api-wrapper";
import { OcrError, readOcrInput, readOcrResponse } from "@/lib/ocr-space";
import { requiresRegisteredRestaurant } from "@/lib/access-policy";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

// Best-effort per-instance protection; the provider also enforces account quotas.
const requests = new Map<string, { count: number; expires: number }>();

export async function POST(request: Request) {
  const json = (body: object, status = 200) =>
    Response.json(body, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  try {
    const origin = request.headers.get("origin");
    // Next.js can use an internal hostname in request.url behind a proxy.
    const host = request.headers.get("host") ?? new URL(request.url).host;
    if (
      (origin &&
        (!/^https?:\/\//.test(origin) || new URL(origin).host !== host)) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      throw new OcrError("Please scan receipts from Hseb Please.", 403);
    const input = await readOcrInput(request);
    if (requiresRegisteredRestaurant()) {
      if (
        !input.restaurantId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          input.restaurantId,
        )
      )
        throw new OcrError(
          "Please select a registered restaurant before scanning.",
          403,
        );
      const supabase = getSupabase();
      if (!supabase)
        throw new OcrError(
          "Restaurant verification is unavailable. Please try again later.",
          503,
        );
      const result = await supabase.rpc("restaurant_can_split", {
        restaurant_id: input.restaurantId,
      });
      if (result.error)
        throw new OcrError(
          "Restaurant verification is unavailable. Please try again later.",
          503,
        );
      if (result.data !== true)
        throw new OcrError(
          "Scanning is not available for this restaurant yet.",
          403,
        );
    }
    const { OCR_SPACE_API_KEY: apiKey } = process.env;
    if (!apiKey)
      throw new OcrError(
        "Receipt scanning is temporarily unavailable. You can still add items manually.",
        503,
      );
    const now = Date.now();
    for (const [key, entry] of requests)
      if (entry.expires <= now) requests.delete(key);
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    const entry = requests.get(ip) ?? { count: 0, expires: now + 60_000 };
    if (entry.count >= 5 || (!requests.has(ip) && requests.size >= 2000))
      throw new OcrError(
        "You’re scanning too quickly. Please wait a minute and try again.",
        429,
      );
    requests.set(ip, { ...entry, count: entry.count + 1 });
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(50_000),
    ]);
    let response;
    try {
      response = await ocrSpace(input.image, {
        apiKey,
        OCREngine: input.language === "eng" ? "2" : "3",
        // The provider supports auto, but the wrapper's language type omits it.
        language: (input.language === "eng"
          ? "eng"
          : "auto") as OcrSpaceOptions["language"],
        isTable: true,
        isOverlayRequired: input.language === "eng",
        detectOrientation: true,
        scale: true,
        signal,
      });
    } catch {
      throw new OcrError(
        signal.aborted
          ? "Scanning took too long. Please try again or add items manually."
          : "The receipt scanner is unavailable right now. Please try again shortly.",
        signal.aborted ? 504 : 502,
      );
    }
    return json(readOcrResponse(response));
  } catch (error) {
    if (error instanceof OcrError)
      return json({ error: error.message }, error.status);
    return json(
      { error: "We couldn’t scan this receipt. Please try again." },
      500,
    );
  }
}

import {
  normalizeReceiptText,
  readReceiptLayout,
  type OcrWord,
} from "./receipt";

export class OcrError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export type OcrInput = {
  image: string;
  language: "eng" | "eng+ara";
  restaurantId?: string;
};

export async function readOcrInput(request: Request): Promise<OcrInput> {
  const maximum = 1_250_000;
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new OcrError("Please upload a receipt image.", 415);
  if (Number(request.headers.get("content-length")) > maximum)
    throw new OcrError(
      "This image is too large to scan. Please crop your receipt.",
      413,
    );
  const reader = request.body?.getReader();
  if (!reader) throw new OcrError("Please upload a receipt image.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new OcrError(
        "This image is too large to scan. Please crop your receipt.",
        413,
      );
    }
    chunks.push(value);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new OcrError("The receipt upload was invalid. Please try again.");
  }
  if (
    !body ||
    typeof body.image !== "string" ||
    !["eng", "eng+ara"].includes(body.language)
  )
    throw new OcrError("Choose a receipt image and a supported language.");
  // Accept image bytes only. Never let clients pass URLs or local paths to the wrapper.
  const match = body.image.match(
    /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/,
  );
  if (!match || match[2].length % 4 !== 0)
    throw new OcrError("Please upload a valid receipt image.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 900_000)
    throw new OcrError(
      "This image is too large to scan. Please crop your receipt.",
      413,
    );
  const valid =
    match[1] === "jpeg"
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!valid) throw new OcrError("This file is not a supported receipt image.");
  return {
    image: body.image,
    language: body.language,
    restaurantId:
      typeof body.restaurantId === "string" ? body.restaurantId : undefined,
  };
}

type ProviderResponse = {
  OCRExitCode?: number | string;
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: unknown;
  ParsedResults?: {
    FileParseExitCode?: number | string;
    ParsedText?: string;
    TextOverlay?: {
      Lines?: {
        Words?: {
          WordText: string;
          Left: number;
          Top: number;
          Width: number;
          Height: number;
        }[];
      }[];
    };
  }[];
};

export function readOcrResponse(response: ProviderResponse) {
  const pages = response?.ParsedResults;
  if (
    response?.IsErroredOnProcessing ||
    Number(response?.OCRExitCode) !== 1 ||
    !pages?.length ||
    pages.some((page) => Number(page.FileParseExitCode) !== 1)
  ) {
    const providerError = JSON.stringify(response?.ErrorMessage ?? "");
    if (/limit|quota|maximum.*requests/i.test(providerError))
      throw new OcrError(
        "Receipt scanning has reached its limit. Please try later or add items manually.",
        429,
      );
    throw new OcrError(
      "We couldn’t read the complete receipt. Try another photo or add items manually.",
      502,
    );
  }
  const text = pages
    .map((page) => page.ParsedText ?? "")
    .join("\n")
    .trim();
  if (!text || text.length > 100_000)
    throw new OcrError(
      "No readable receipt text was found. Try a clearer photo or add items manually.",
      422,
    );
  const words: OcrWord[] = pages
    .flatMap((page) => page.TextOverlay?.Lines ?? [])
    .flatMap((line) => line.Words ?? [])
    .filter(
      (word) =>
        typeof word.WordText === "string" &&
        [word.Left, word.Top, word.Width, word.Height].every(Number.isFinite),
    )
    .map((word) => ({
      text: word.WordText,
      bbox: {
        x0: word.Left,
        y0: word.Top,
        x1: word.Left + word.Width,
        y1: word.Top + word.Height,
      },
    }));
  const layout = words.length ? readReceiptLayout({ text, words }) : null;
  return {
    text: normalizeReceiptText(layout?.text ?? text),
    restaurantName: layout?.restaurantName ?? null,
  };
}

import type { Line, Page, Word } from "tesseract.js";
import {
  inferAmountCurrency,
  toMinor,
  type BillItem,
  type Currency,
} from "./bill";

export type ParsedReceipt = {
  items: BillItem[];
  detectedSubtotal: number | null;
  restaurantName: string | null;
  currency: Currency;
};

type OcrPage = Pick<Page, "text" | "blocks">;
type ReceiptRow = Pick<Line, "words" | "text" | "bbox">;
const letters = /[a-z\u0620-\u064a]/i;
const arabic = /[\u0620-\u064a]/;
const metadata =
  /\b(?:cash|change|visa|mastercard|payment|paid|discount|saving|phone|tel|table|guest|order|invoice|receipt|check|date|time|manager|powered|served|thank)\b|خصم|الباقي/i;
const charges =
  /\b(?:tax|vat|tip|gratuity|service(?:\s*(?:charge|fee))?)\b|ضريبة|خدمة|إكرامية/i;
const totalLabel =
  /\b(?:total|subtotal|sub\s+total|amount\s*due|balance\s*due)\b|الإجمالي|المجموع/i;
const subtotalLabel = /\b(?:subtotal|sub\s+total)\b|المجموع الفرعي/i;
const separator = /^[\s\-_=~—–.·•:]{6,}$/;

function clean(text: string) {
  return text
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/٫/g, ".")
    .replace(/٬/g, ",")
    .replace(/(\d,)\s+(?=\d)/g, "$1")
    .trim();
}
function price(value: string): number | null {
  const text = /^\d+,\d{2}$/.test(value)
    ? value.replace(",", ".")
    : value.replace(/,/g, "");
  return /^\d+(?:\.\d{1,2})?$/.test(text) ? Number(text) : null;
}
function currencyLabel(text: string): Currency | null {
  if (/\b(?:LBP|L\.?L\.?)\b|ل\.?\s*ل\.?/i.test(text)) return "LBP";
  if (/\bUSD\b|\$/i.test(text)) return "USD";
  return null;
}
function isHeader(text: string) {
  return (
    letters.test(text) &&
    !metadata.test(text) &&
    !charges.test(text) &&
    !totalLabel.test(text) &&
    !/^\d/.test(text)
  );
}

type RawItem = {
  name: string;
  quantity: number;
  value: number;
  currency: Currency | null;
};
function readItem(line: string): RawItem | null {
  if (metadata.test(line) || charges.test(line) || totalLabel.test(line))
    return null;
  const unit = currencyLabel(line);
  const stripped = line.replace(/\b(?:USD|LBP|LL)\b|\$/gi, "").trim();
  let match = stripped.match(/^(.*?)\s+(-?\d[\d,.]*)\s*[|]*$/);
  // Some right-to-left OCR outputs place the price first and quantity last.
  const reversed = stripped.match(/^(\d[\d,.]*)\s+(.+?)\s*(\d{1,3})$/);
  if (
    reversed &&
    arabic.test(reversed[2]) &&
    Number(reversed[1].replace(/,/g, "")) > 999
  ) {
    match = [
      `${reversed[3]} ${reversed[2]} ${reversed[1]}`,
      `${reversed[3]} ${reversed[2]}`,
      reversed[1],
    ];
  }
  if (!match) return null;
  let name = match[1].trim();
  const value = price(match[2]);
  if (value === null || !letters.test(name)) return null;
  const quantityMatch = name.match(/^(\d{1,3})\s*(?:[x×]\s*|\s+)(.+)$/i);
  const quantity = quantityMatch ? Math.max(1, Number(quantityMatch[1])) : 1;
  if (quantityMatch) name = quantityMatch[2].trim();
  return { name, quantity, value, currency: unit };
}

export function parseReceipt(
  text: string,
  fallbackCurrency: Currency,
): ParsedReceipt {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const dividers = lines
    .map((line, index) => (separator.test(line) ? index : -1))
    .filter((index) => index >= 0);
  let itemLines = lines;
  let headerLines: string[] = [];
  if (dividers.length) {
    const sections = dividers.map((start, i) => ({
      start,
      lines: lines.slice(start + 1, dividers[i + 1] ?? lines.length),
    }));
    const best = sections.sort(
      (a, b) =>
        b.lines.filter((line) => readItem(line)).length -
        a.lines.filter((line) => readItem(line)).length,
    )[0];
    itemLines = best.lines;
    headerLines = lines.slice(0, best.start);
  }
  const rawItems = itemLines
    .map(readItem)
    .filter((item): item is RawItem => !!item);
  if (!headerLines.length) {
    const firstItem = lines.findIndex((line) => !!readItem(line));
    headerLines = lines.slice(0, Math.max(0, firstItem));
  }
  const totals = lines
    .filter((line) => totalLabel.test(line))
    .flatMap((line) => {
      const match = line.match(/(-?\d[\d,.]*)\s*[|]*$/);
      const value = match ? price(match[1]) : null;
      return value !== null
        ? [
            {
              value,
              currency: currencyLabel(line),
              subtotal: subtotalLabel.test(line),
            },
          ]
        : [];
    });
  const rawSum = rawItems.reduce((sum, item) => sum + item.value, 0);
  const explicitCurrencies = rawItems
    .map((item) => item.currency)
    .filter(Boolean);
  let currency = explicitCurrencies[0] ?? fallbackCurrency;
  const labeledTotals = totals.filter((total) => total.currency);
  if (!explicitCurrencies.length && labeledTotals.length) {
    const closest = [...labeledTotals].sort(
      (a, b) =>
        Math.abs(rawSum - a.value) / Math.max(a.value, 1) -
        Math.abs(rawSum - b.value) / Math.max(b.value, 1),
    )[0];
    if (
      new Set(labeledTotals.map((total) => total.currency)).size === 1 ||
      Math.abs(rawSum - closest.value) / Math.max(closest.value, 1) < 0.2
    )
      currency = closest.currency!;
  }
  // Only item prices count: converted totals, phone numbers and check IDs don't.
  currency = inferAmountCurrency(rawSum, currency);
  const subtotal = totals.find(
    (total) =>
      total.subtotal && (!total.currency || total.currency === currency),
  );
  const comparableTotal =
    subtotal ??
    (!lines.some((line) => charges.test(line) || /discount|خصم/i.test(line))
      ? totals.find(
          (total) =>
            !total.subtotal && (!total.currency || total.currency === currency),
        )
      : undefined);
  return {
    currency,
    restaurantName: headerLines.find(isHeader)?.replace(/\s+/g, " ") ?? null,
    detectedSubtotal: comparableTotal
      ? toMinor(String(comparableTotal.value), currency)
      : null,
    items: rawItems.map((item, index) => ({
      id: `ocr-${index}`,
      name: item.name,
      quantity: item.quantity,
      amount: toMinor(String(item.value), currency),
      personIds: [],
    })),
  };
}

function pageRows(page: OcrPage): ReceiptRow[] {
  // Rejoin price/name columns by vertical position even if OCR returns separate blocks.
  const words =
    page.blocks?.flatMap((block) =>
      block.paragraphs.flatMap((paragraph) =>
        paragraph.lines.flatMap((line) => line.words),
      ),
    ) ?? [];
  const heights = words
    .map((word) => word.bbox.y1 - word.bbox.y0)
    .filter((h) => h > 3)
    .sort((a, b) => a - b);
  const tolerance = (heights[Math.floor(heights.length / 2)] || 20) * 0.55;
  const rows: { center: number; words: Word[] }[] = [];
  for (const word of [...words].sort(
    (a, b) => a.bbox.y0 + a.bbox.y1 - (b.bbox.y0 + b.bbox.y1),
  )) {
    if (!clean(word.text) || word.bbox.y1 - word.bbox.y0 < 3) continue;
    const center = (word.bbox.y0 + word.bbox.y1) / 2;
    const row = rows.find((row) => Math.abs(row.center - center) <= tolerance);
    if (row) {
      row.center =
        (row.center * row.words.length + center) / (row.words.length + 1);
      row.words.push(word);
    } else rows.push({ center, words: [word] });
  }
  return rows.map((row) => {
    const words = row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    return {
      words,
      text: words.map((w) => clean(w.text)).join(" "),
      bbox: {
        x0: Math.min(...words.map((w) => w.bbox.x0)),
        y0: Math.min(...words.map((w) => w.bbox.y0)),
        x1: Math.max(...words.map((w) => w.bbox.x1)),
        y1: Math.max(...words.map((w) => w.bbox.y1)),
      },
    };
  });
}

function rowItem(row: ReceiptRow) {
  if (
    metadata.test(row.text) ||
    charges.test(row.text) ||
    totalLabel.test(row.text)
  )
    return null;
  const words = row.words.filter((word) =>
    /[\da-z\u0620-\u064a]/i.test(clean(word.text)),
  );
  const right = words[words.length - 1];
  if (!right || price(clean(right.text)) === null) return null;
  const first = words[0];
  const quantity =
    /^\d{1,3}$/.test(clean(first.text)) && words.length > 2 ? first : null;
  const nameWords = words.filter((word) => word !== right && word !== quantity);
  if (!nameWords.some((word) => letters.test(clean(word.text)))) return null;
  const isArabic = nameWords.some((word) => arabic.test(word.text));
  const name = [...nameWords]
    .sort((a, b) => (isArabic ? b.bbox.x0 - a.bbox.x0 : a.bbox.x0 - b.bbox.x0))
    .map((w) => clean(w.text))
    .join(" ");
  return {
    name,
    quantity: quantity ? clean(quantity.text) : "1",
    amount: clean(right.text),
    uncertain: nameWords.some((word) => word.confidence < 70),
    center: (row.bbox.y0 + row.bbox.y1) / 2,
  };
}

/** Restore the visual item columns, independent of English/Arabic reading order. */
export function readReceiptLayout(
  page: OcrPage,
  separators: number[] = [],
  arabicPage?: OcrPage,
) {
  const rows = pageRows(page);
  if (!rows.length)
    return { text: page.text, restaurantName: null, uncertainNames: false };
  const alternateRows = arabicPage ? pageRows(arabicPage) : [];
  // A lone detected rule is not enough to identify an item region safely.
  if (separators.length < 2) separators = [];
  const regions = separators
    .slice(0, -1)
    .map((top, i) => ({ top, bottom: separators[i + 1] }));
  const region = regions.sort((a, b) => {
    const count = (bounds: { top: number; bottom: number }) =>
      rows.filter((row) => {
        const center = (row.bbox.y0 + row.bbox.y1) / 2;
        return center > bounds.top && center < bounds.bottom && rowItem(row);
      }).length;
    return count(b) - count(a);
  })[0];
  const inItems = (row: ReceiptRow) =>
    !region ||
    ((row.bbox.y0 + row.bbox.y1) / 2 > region.top &&
      (row.bbox.y0 + row.bbox.y1) / 2 < region.bottom);
  const firstItem = rows.find((row) => inItems(row) && rowItem(row));
  const header = rows.filter(
    (row) =>
      (!firstItem || row.bbox.y1 < firstItem.bbox.y0) && isHeader(row.text),
  );
  const restaurantName =
    [...header].sort(
      (a, b) =>
        Math.max(...b.words.map((w) => w.bbox.y1 - w.bbox.y0)) -
        Math.max(...a.words.map((w) => w.bbox.y1 - w.bbox.y0)),
    )[0]?.text ?? null;
  let uncertainNames = false;
  const output: string[] = [];
  let divider = 0;
  for (const row of rows) {
    const center = (row.bbox.y0 + row.bbox.y1) / 2;
    while (divider < separators.length && center > separators[divider]) {
      output.push("----------------");
      divider++;
    }
    const item = inItems(row) ? rowItem(row) : null;
    if (item) {
      if (item.uncertain && alternateRows.length) {
        const alternate = alternateRows.find(
          (candidate) =>
            Math.abs(
              (candidate.bbox.y0 + candidate.bbox.y1) / 2 - item.center,
            ) <
            (row.bbox.y1 - row.bbox.y0) * 0.65,
        );
        const name = alternate && rowItem(alternate)?.name;
        if (name && arabic.test(name) && !/[a-z]/i.test(name)) item.name = name;
      }
      uncertainNames ||= item.uncertain;
      output.push(`${item.quantity} ${item.name} ${item.amount}`);
    } else output.push(row.text);
  }
  while (divider++ < separators.length) output.push("----------------");
  return { text: output.join("\n"), restaurantName, uncertainNames };
}

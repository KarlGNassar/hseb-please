import { toMinor, type BillItem, type Currency } from "./bill";

export type ParsedReceipt = {
  items: BillItem[];
  detectedSubtotal: number | null;
};

export function parseReceipt(text: string, currency: Currency): ParsedReceipt {
  const result: ParsedReceipt = {
    items: [],
    detectedSubtotal: null,
  };
  const normalized = text
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
  for (const raw of normalized.split(/\r?\n/)) {
    const line = raw.trim();
    const match = line.match(
      /^(.*?)\s+[$]?\s*(-?\d[\d,.]*)(?:\s*(?:USD|LBP|\$))?\s*$/i,
    );
    if (!match) continue;
    let name = match[1].trim();
    let price = match[2];
    if (price.startsWith("-")) continue;
    // Support decimal commas and grouping separators; never interpret a discount as a charge.
    if (/^\d+,\d{2}$/.test(price)) price = price.replace(",", ".");
    else price = price.replace(/,/g, "");
    if (!/^\d+(?:\.\d{1,2})?$/.test(price)) continue;
    const amount = toMinor(price, currency);
    if (!name || !amount) continue;
    if (/sub\s*total|المجموع الفرعي/i.test(name)) {
      result.detectedSubtotal = amount;
      continue;
    }
    // Only item amounts are split. Never treat receipt-level charges as items.
    if (
      /\b(?:tax|vat|tip|gratuity|service(?:\s*(?:charge|fee))?)\b|ضريبة|خدمة|إكرامية/i.test(
        name,
      )
    )
      continue;
    if (/total|amount\s*due|balance\s*due|الإجمالي|المجموع/i.test(name))
      continue;
    if (
      /cash|change|visa|mastercard|payment|paid|discount|saving|phone|tel\b|table|guest|order|invoice|receipt|date|time|خصم|الباقي/i.test(
        name,
      )
    )
      continue;
    const quantityMatch = name.match(/^(\d{1,3})\s*(?:[x×]\s*|\s+)(.+)$/i);
    const quantity = quantityMatch ? Math.max(1, Number(quantityMatch[1])) : 1;
    if (quantityMatch) name = quantityMatch[2].trim();
    // Receipt line amounts are totals for the displayed quantity, not unit prices.
    if (/[a-z\u0600-\u06ff]/i.test(name))
      result.items.push({
        id: `ocr-${result.items.length}`,
        name,
        quantity,
        amount,
        personIds: [],
      });
  }
  return result;
}

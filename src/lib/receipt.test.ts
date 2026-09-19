import test from "node:test";
import assert from "node:assert/strict";
import { parseReceipt, readReceiptLayout } from "./receipt";
import type { Page, Word } from "tesseract.js";

test("parses line totals without multiplying quantities or including payment totals", () => {
  const receipt = parseReceipt(
    "BEIRUT KITCHEN\n2 x Mint lemonade 8.00\nHummus & pita $6.50\nSubtotal 14.50\nVAT 1.60\nService charge 2.00\nTOTAL 18.10\nCASH 20.00\nCHANGE 1.90\nReceipt 12345",
    "USD",
  );
  assert.equal(receipt.items.length, 2);
  assert.deepEqual(
    receipt.items.map((i) => [i.name, i.quantity, i.amount]),
    [
      ["Mint lemonade", 2, 800],
      ["Hummus & pita", 1, 650],
    ],
  );
  assert.equal(receipt.detectedSubtotal, 1450);
  assert.equal(
    receipt.items.reduce((sum, item) => sum + item.amount, 0),
    1450,
  );
});

const arabicReceipt = `Koukh El Sabaya
Mtein Main Road
Mtein
03658734
TABLE
06-09-2026 10:03
CHECK # 104406 TABLE # 15
------------------------
1 نسكافيه 225000
1 شاي مع حليب 225000
1 شاي أخضر 135000
1 سفن اب دايت 135000
1 ماء كبير 135000
1 عصير مانغا 90000
1 خضرة كبير 450000
1 زعتر مع خضره 315000
1 قشقوان 540000
2 صحن بيض مع قاورما 1260000
2 صحن بيض مع زبدة 810000
4 قشقوان مع قورما 2700000
------------------------
TOTAL LL: 7,020, 000
TOTAL $: 78.00
Cash $: 78.00
You Have been served by:
Manager
Thank you 4`;

test("dashed sections isolate Arabic items and detect LBP on dual-currency receipts", () => {
  const receipt = parseReceipt(arabicReceipt, "USD");
  assert.equal(receipt.restaurantName, "Koukh El Sabaya");
  assert.equal(receipt.currency, "LBP");
  assert.equal(receipt.items.length, 12);
  assert.equal(
    receipt.items.reduce((sum, item) => sum + item.amount, 0),
    7020000,
  );
  assert.equal(receipt.detectedSubtotal, 7020000);
  assert.deepEqual(
    receipt.items.slice(-3).map((item) => item.quantity),
    [2, 2, 4],
  );
});

test("dual totals do not imply LBP when the item amounts are USD", () => {
  const receipt = parseReceipt(
    "Cafe\n------\n1 Coffee 3.00\n------\nTOTAL LL: 270,000\nTOTAL $: 3.00",
    "LBP",
  );
  assert.equal(receipt.currency, "USD");
  assert.equal(receipt.items[0].amount, 300);
});

test("RTL price-first OCR and bidirectional marks preserve quantities", () => {
  const receipt = parseReceipt(
    "Cafe\n------\n١٢٦٠٠٠٠ ‏صحن بيض مع قاورما‎٢\n------\nTOTAL LL: 1,260,000",
    "USD",
  );
  assert.equal(receipt.items[0].name, "صحن بيض مع قاورما");
  assert.equal(receipt.items[0].quantity, 2);
  assert.equal(receipt.items[0].amount, 1260000);
});

test("image word positions rejoin separate columns and preserve RTL name order", () => {
  const word = (text: string, x: number, y: number, width = 30, height = 20) =>
    ({
      text,
      confidence: 95,
      bbox: { x0: x, x1: x + width, y0: y, y1: y + height },
    }) as Word;
  const words = [
    word("Koukh El Sabaya", 60, 10, 200, 40),
    word("Mtein", 80, 60),
    word("2", 10, 150),
    word("حليب", 70, 151),
    word("مع", 120, 153),
    word("شاي", 160, 152),
    word("450000", 300, 150, 80),
  ];
  const page = {
    text: "garbled",
    blocks: words.map((w) => ({ paragraphs: [{ lines: [{ words: [w] }] }] })),
  } as unknown as Pick<Page, "text" | "blocks">;
  const layout = readReceiptLayout(page, [100, 200]);
  assert.equal(layout.restaurantName, "Koukh El Sabaya");
  const receipt = parseReceipt(layout.text, "LBP");
  assert.deepEqual(
    receipt.items.map((item) => [item.quantity, item.name, item.amount]),
    [[2, "شاي مع حليب", 450000]],
  );
});

test("Arabic digits, decimal commas, and Lebanese lira grouping are supported", () => {
  assert.equal(parseReceipt("حمص ٦٫٥٠", "USD").items[0].amount, 650);
  assert.equal(parseReceipt("Salad 7,50", "USD").items[0].amount, 750);
  assert.equal(
    parseReceipt("Hummus 125,000 LBP", "LBP").items[0].amount,
    125000,
  );
});

test("discounts and malformed OCR lines are left for manual review", () => {
  const parsed = parseReceipt(
    "Phone 123456\nDiscount 5.00\nCoupon -2.00\n12.22.33\nNot a receipt",
    "USD",
  );
  assert.equal(parsed.items.length, 0);
  assert.equal(parsed.detectedSubtotal, null);
});

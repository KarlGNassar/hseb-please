import test from "node:test";
import assert from "node:assert/strict";
import { parseReceipt } from "./receipt";

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

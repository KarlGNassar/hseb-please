import test from "node:test";
import assert from "node:assert/strict";
import { readOcrInput, readOcrResponse } from "./ocr-space";
import { normalizeReceiptText, parseReceipt } from "./receipt";

const image = "data:image/jpeg;base64,/9j/2Q==";
const request = (body: unknown) =>
  new Request("https://hseb.test/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("OCR uploads only accept bounded image data and known languages", async () => {
  assert.equal(
    (await readOcrInput(request({ image, language: "eng+ara" }))).image,
    image,
  );
  for (const invalid of [
    "https://example.com/receipt.jpg",
    "/etc/passwd",
    "data:image/jpeg;base64,aGVsbG8=",
    "data:text/html;base64,aGVsbG8=",
  ]) {
    await assert.rejects(
      readOcrInput(request({ image: invalid, language: "eng+ara" })),
    );
  }
  await assert.rejects(readOcrInput(request({ image, language: "anything" })));
  await assert.rejects(
    readOcrInput(request({ image: "a".repeat(1_250_001), language: "eng" })),
    { status: 413 },
  );
});

test("provider errors and partial scans never become bill items or expose details", () => {
  for (const response of [
    {
      OCRExitCode: 2,
      IsErroredOnProcessing: false,
      ParsedResults: [{ FileParseExitCode: 1, ParsedText: "Coffee 3.00" }],
    },
    {
      OCRExitCode: 1,
      ParsedResults: [{ FileParseExitCode: -20, ParsedText: "Coffee 3.00" }],
    },
    {
      OCRExitCode: 4,
      IsErroredOnProcessing: true,
      ErrorMessage: "private provider details",
    },
  ])
    assert.throws(() => readOcrResponse(response), { status: 502 });
  assert.throws(
    () =>
      readOcrResponse({
        OCRExitCode: 4,
        ErrorMessage: ["API daily limit exceeded"],
      }),
    { status: 429 },
  );
  assert.throws(
    () =>
      readOcrResponse({
        OCRExitCode: 1,
        ParsedResults: [{ FileParseExitCode: 1, ParsedText: "" }],
      }),
    { status: 422 },
  );
});

test("OCR.Space Markdown preserves line totals, Arabic quantities and restaurant headings", () => {
  const result = readOcrResponse({
    OCRExitCode: "1",
    ParsedResults: [
      {
        FileParseExitCode: "1",
        ParsedText:
          "# Cafe Beirut\n| Qty | Description | Unit price | Total |\n| --- | --- | --- | --- |\n| 2 | Coffee | 3.00 | 6.00 |\n| 1 | Tea | 2.00 | 2.00 |\n\n**TOTAL $: 8.00**\nTOTAL LL: 720000\nTax 0.80",
      },
    ],
  });
  const bill = parseReceipt(result.text, "USD");
  assert.equal(bill.restaurantName, "Cafe Beirut");
  assert.equal(bill.currency, "USD");
  assert.deepEqual(
    bill.items.map((item) => [item.name, item.quantity, item.amount]),
    [
      ["Coffee", 2, 600],
      ["Tea", 1, 200],
    ],
  );
  const arabic = parseReceipt(
    "Koukh El Sabaya\nنسكافيه 1 225000\nصحن بيض مع قاورما 2 1260000\nقشقوان مع قورما 4 2700000\nTOTAL LL: 4185000\nTOTAL $: 46.50",
    "USD",
  );
  assert.equal(arabic.currency, "LBP");
  assert.deepEqual(
    arabic.items.map((item) => [item.name, item.quantity, item.amount]),
    [
      ["نسكافيه", 1, 225000],
      ["صحن بيض مع قاورما", 2, 1260000],
      ["قشقوان مع قورما", 4, 2700000],
    ],
  );
});

test("separate description and price columns preserve quantities and LBP amounts", () => {
  const bill = parseReceipt(
    "Koukh El Sabaya\nTABLE 15\nنسكافيه 1\nصحن بيض مع قاورما 2\nقشقوان مع قورما 4\n225000\n1260000\n2700000\nTOTAL LL: 4185000\nTOTAL $: 46.50",
    "USD",
  );
  assert.equal(bill.currency, "LBP");
  assert.deepEqual(
    bill.items.map((item) => [item.name, item.quantity, item.amount]),
    [
      ["نسكافيه", 1, 225000],
      ["صحن بيض مع قاورما", 2, 1260000],
      ["قشقوان مع قورما", 4, 2700000],
    ],
  );
  assert.equal(bill.detectedSubtotal, 4185000);
  const incomplete = "Coffee 1\nTea 2\nWater 1\n225000\n90000";
  assert.equal(normalizeReceiptText(incomplete), incomplete);
});

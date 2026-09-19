import { test, expect } from "@playwright/test";

test("real Tesseract worker reads an uploaded receipt image", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.TEST_LIVE_OCR !== "1" || testInfo.project.name !== "desktop",
    "Opt-in test downloads Tesseract worker and language assets.",
  );
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.locator(".receipt-options select")).toHaveValue("eng+ara");
  const receipt = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 600;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, 1000, 600);
    context.fillStyle = "black";
    context.font = "32px monospace";
    [
      "BEIRUT KITCHEN",
      "",
      "Hummus             6.50",
      "Mint Lemonade      8.00",
      "Subtotal          14.50",
      "Tax                1.60",
      "TOTAL             16.10",
    ].forEach((line, index) => context.fillText(line, 60, 70 + index * 65));
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Upload receipt image", { exact: true }).setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: Buffer.from(receipt, "base64"),
  });
  await expect(
    page.getByText(
      "Receipt scanned. Check the item names and line totals before continuing.",
    ),
  ).toBeVisible({ timeout: 100_000 });
  await expect(page.getByLabel("Item 1 name")).toHaveValue("Hummus");
  await expect(page.getByLabel("Item 2 name")).toHaveValue("Mint Lemonade");
  await expect(page.locator(".grand-total strong")).toHaveText("$14.50");
});

test("photographed Arabic receipt preserves the item table and LBP prices", async ({
  page,
}, testInfo) => {
  const photo = process.env.TEST_RECEIPT_IMAGE;
  test.skip(
    !photo || testInfo.project.name !== "desktop",
    "Supply a local receipt photo using TEST_RECEIPT_IMAGE.",
  );
  test.setTimeout(180_000);
  await page.goto("/");
  await expect(page.locator(".receipt-options select")).toHaveValue("eng+ara");
  await page
    .getByLabel("Upload receipt image", { exact: true })
    .setInputFiles(photo!);
  await expect(page.locator(".item-block")).toHaveCount(12, {
    timeout: 150_000,
  });
  await expect(page.getByLabel("Currency", { exact: true })).toHaveValue("LBP");
  await expect(
    page.getByLabel("ANY RESTAURANT. EVERYONE WELCOME."),
  ).toHaveValue("Koukh El Sabaya");
  await expect(page.locator(".grand-total strong")).toHaveText(/7,020,000/);
  await expect(page.locator(".item-name input").first()).toHaveValue(/نسكاف/);
  expect(
    await page
      .locator(".amount-input")
      .evaluateAll((inputs) =>
        inputs.map((input) => Number((input as HTMLInputElement).value)),
      ),
  ).toEqual([
    225000, 225000, 135000, 135000, 135000, 90000, 450000, 315000, 540000,
    1260000, 810000, 2700000,
  ]);
  expect(
    await page
      .locator(".quantity-input")
      .evaluateAll((inputs) =>
        inputs.map((input) => Number((input as HTMLInputElement).value)),
      ),
  ).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 4]);
});

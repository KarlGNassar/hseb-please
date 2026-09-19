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

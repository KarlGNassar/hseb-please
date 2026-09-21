import { test, expect } from "@playwright/test";

test("OCR.Space reads an uploaded receipt image", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.TEST_LIVE_OCR !== "1" || testInfo.project.name !== "desktop",
    "Opt-in test sends a synthetic receipt to OCR.Space using the configured key.",
  );
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.locator(".receipt-options select")).toHaveValue("eng+ara");
  await page.locator(".receipt-options select").selectOption("eng");
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
  const scanResponse = page.waitForResponse("**/api/ocr", { timeout: 65_000 });
  await page.getByLabel("Upload receipt image", { exact: true }).setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: Buffer.from(receipt, "base64"),
  });
  const response = await scanResponse;
  expect(response.ok(), await response.text()).toBe(true);
  await expect(
    page.getByText(
      "Receipt scanned. Check the item names and line totals before continuing.",
    ),
  ).toBeVisible({ timeout: 100_000 });
  await expect(page.getByLabel("Item 1 name")).toHaveValue("Hummus");
  await expect(page.getByLabel("Item 2 name")).toHaveValue("Mint Lemonade");
  await expect(page.locator(".grand-total strong")).toHaveText("$14.50");
});

test("receipt uploads use the app endpoint and preserve bills when scanning fails", async ({
  page,
}) => {
  await page.goto("/");
  const receipt = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 500;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, 800, 500);
    context.fillStyle = "black";
    context.font = "30px sans-serif";
    context.fillText("Cafe Beirut", 30, 50);
    context.fillText("Coffee 225000", 30, 100);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  let fail = false;
  await page.route("**/api/ocr", async (route) => {
    const body = route.request().postDataJSON();
    expect(Object.keys(body).sort()).toEqual(["image", "language"]);
    expect(body.language).toBe("eng+ara");
    expect(body.image).toMatch(/^data:image\/jpeg;base64,/);
    expect(
      Buffer.from(body.image.split(",")[1], "base64").byteLength,
    ).toBeLessThanOrEqual(900000);
    await route.fulfill({
      status: fail ? 429 : 200,
      json: fail
        ? {
            error:
              "Receipt scanning has reached its limit. Please try later or add items manually.",
          }
        : {
            text: "Cafe Beirut\nقهوة 2 225000\nTOTAL LL: 225000\nTOTAL $: 2.50",
            restaurantName: null,
          },
    });
  });
  const upload = () =>
    page.getByLabel("Upload receipt image", { exact: true }).setInputFiles({
      name: "receipt.png",
      mimeType: "image/png",
      buffer: Buffer.from(receipt, "base64"),
    });
  await upload();
  await expect(page.getByLabel("Item 1 name")).toHaveValue("قهوة");
  await expect(page.getByLabel("Quantity for قهوة")).toHaveValue("2");
  await expect(page.getByLabel("Line total for قهوة")).toHaveValue("225000");
  await expect(page.getByLabel("Currency", { exact: true })).toHaveValue("LBP");
  await expect(page.locator("#items-section")).toBeFocused();
  fail = true;
  await upload();
  await page
    .getByRole("button", { name: "Scan new receipt", exact: true })
    .click();
  await expect(
    page.getByText(
      "Receipt scanning has reached its limit. Please try later or add items manually.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Line total for قهوة")).toHaveValue("225000");
  await expect(
    page.getByRole("button", { name: "Upload receipt", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("Item 1 name")).toHaveValue("قهوة");
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
  const scanResponse = page.waitForResponse("**/api/ocr", { timeout: 65_000 });
  await page
    .getByLabel("Upload receipt image", { exact: true })
    .setInputFiles(photo!);
  const response = await scanResponse;
  expect(response.ok(), await response.text()).toBe(true);
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

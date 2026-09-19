import { test, expect } from "@playwright/test";
import { demoBill } from "../src/lib/bill";

test("free release supports any restaurant, group edits, equal splitting, and saved drafts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Upload receipt", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("ANY RESTAURANT. EVERYONE WELCOME.")
    .fill("Cafe Beirut");
  await page.getByRole("button", { name: "Try a sample receipt" }).click();
  await expect(page.locator("#items-section")).toBeFocused();
  await expect(page.locator("#items-section")).toBeInViewport();
  await expect(page.getByLabel("Tax", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Tip / service", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Add your people" }).click();
  await expect(page.locator("#people-section")).toBeFocused();
  await expect(page.locator("#people-section")).toBeInViewport();
  await page.getByLabel("New person’s name").fill("Karl");
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  await page.getByRole("button", { name: "Remove Jad", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Let’s split it" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Split equally", exact: true })
    .click();
  await page.getByRole("button", { name: "Let’s split it" }).click();
  await expect(page.locator("#split-section")).toBeFocused();
  await expect(page.locator("#split-section")).toBeInViewport();
  await expect(
    page.getByRole("heading", { name: "Here’s everyone’s share." }),
  ).toBeVisible();
  await expect(page.locator(".person-total")).toHaveText([
    "$12.00",
    "$12.00",
    "$12.00",
  ]);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "hseb-please-split.txt",
  );
  await page.reload();
  await expect(page.getByLabel("Item 1 name")).toHaveValue(
    "Hummus & warm pita",
  );
  await expect(
    page.getByLabel("ANY RESTAURANT. EVERYONE WELCOME."),
  ).toHaveValue("Cafe Beirut");
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `/tmp/hseb-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("manual line totals and shared items reconcile through the real API", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add items manually" }).click();
  await expect(page.getByLabel("Item 1 name")).toBeFocused();
  await expect(page.getByLabel("Item 1 name")).toBeInViewport();
  await page.getByLabel("Item 1 name").fill("Coffee");
  await page.getByLabel("Line total for Coffee").fill("10.01");
  await page.getByLabel("Line total for Coffee").blur();
  await page.getByRole("button", { name: "Add your people" }).click();
  await page.getByLabel("New person’s name").fill("Maya");
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  await page.getByRole("button", { name: "Everyone", exact: true }).click();
  await page.getByRole("button", { name: "Let’s split it" }).click();
  await expect(page.locator(".person-total")).toHaveText(["$5.01", "$5.00"]);
});

test("the server toggle cannot be bypassed by omitting or inventing a restaurant", async ({
  request,
  page,
}) => {
  const free = await request.post("/api/split", { data: { bill: demoBill() } });
  expect(free.status()).toBe(200);
  const missing = await request.post("http://127.0.0.1:3101/api/split", {
    data: { bill: demoBill() },
  });
  expect(missing.status()).toBe(403);
  const invented = await request.post("http://127.0.0.1:3101/api/split", {
    data: {
      bill: demoBill(),
      restaurantId: "00000000-0000-0000-0000-000000000001",
    },
  });
  expect(invented.status()).toBe(503);
  await page.goto("http://127.0.0.1:3101");
  await expect(
    page.getByRole("button", { name: "Upload receipt", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Choose restaurant" }).click();
  await expect(page.getByText("We’re getting the tables ready.")).toBeVisible();
});

test("the API rejects unassigned items and malformed money", async ({
  request,
}) => {
  const legacy = await request.post("/api/split", {
    data: { bill: { ...demoBill(), tax: 396, tip: 540 } },
  });
  expect(legacy.status()).toBe(200);
  expect((await legacy.json()).split.total).toBe(3600);
  const bill = demoBill();
  bill.items[0].personIds = [];
  expect((await request.post("/api/split", { data: { bill } })).status()).toBe(
    400,
  );
  expect(
    (
      await request.post("/api/split", {
        data: {
          bill: {
            ...demoBill(),
            items: [{ ...demoBill().items[0], amount: -1 }],
          },
        },
      })
    ).status(),
  ).toBe(400);
  for (const currency of ["EUR", "GBP"]) {
    expect(
      (
        await request.post("/api/split", {
          data: { bill: { ...demoBill(), currency } },
        })
      ).status(),
    ).toBe(400);
  }
});

test("currency and reset confirmations stay in the app and preserve cancelled changes", async ({
  page,
}) => {
  const browserDialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    browserDialogs.push(dialog.type());
    await dialog.dismiss();
  });
  await page.goto("/");
  await expect(
    page.getByLabel("Currency", { exact: true }).locator("option"),
  ).toHaveText(["USD", "LBP"]);
  await page.getByRole("button", { name: "Try a sample receipt" }).click();
  const currency = page.getByLabel("Currency", { exact: true });
  await currency.focus();
  await currency.selectOption("LBP");
  const confirmation = page.getByRole("dialog", { name: "Switch to LBP?" });
  await expect(confirmation).toBeVisible();
  await expect(
    confirmation.getByRole("button", { name: "Keep USD" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).not.toBeVisible();
  await expect(currency).toHaveValue("USD");
  await expect(currency).toBeFocused();
  await expect(
    page.getByLabel("Line total for Hummus & warm pita"),
  ).toHaveValue("6.50");
  await currency.focus();
  await currency.selectOption("LBP");
  await confirmation
    .getByRole("button", { name: "Switch to LBP", exact: true })
    .click();
  await expect(currency).toHaveValue("LBP");
  await expect(
    page.getByLabel("Line total for Hummus & warm pita"),
  ).toHaveValue("7");

  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Keep my bill" })
    .click();
  await expect(page.getByLabel("Item 1 name")).toHaveValue(
    "Hummus & warm pita",
  );
  await page.getByRole("button", { name: "Try a sample receipt" }).click();
  await expect(
    page.getByRole("dialog", { name: "Take a sample for a spin?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Load sample receipt", exact: true })
    .click();
  await expect(currency).toHaveValue("USD");

  await page.getByLabel("Upload receipt image", { exact: true }).setInputFiles({
    name: "replacement.png",
    mimeType: "image/png",
    buffer: Buffer.from("confirmation-only"),
  });
  await expect(
    page.getByRole("dialog", { name: "Scan a new receipt?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep my bill", exact: true }).click();
  await expect(page.getByLabel("Item 1 name")).toHaveValue(
    "Hummus & warm pita",
  );

  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await page
    .getByRole("button", { name: "Start a new bill", exact: true })
    .click();
  await expect(page.getByLabel("Item 1 name")).not.toBeVisible();
  expect(browserDialogs).toEqual([]);
});

test("restaurant change confirmation works above the directory", async ({
  page,
}) => {
  const restaurants = ["First Cafe", "Second Cafe"].map((name, i) => ({
    id: `00000000-0000-0000-0000-00000000000${i + 1}`,
    slug: `cafe-${i}`,
    name,
    city: "Beirut",
    status: "active",
    splitting_enabled: true,
    split_access_expires_at: null,
  }));
  await page.route("**/api/restaurants?*", (route) =>
    route.fulfill({ json: { restaurants } }),
  );
  await page.goto("http://127.0.0.1:3101");
  await page.getByRole("button", { name: "Choose restaurant" }).click();
  await page.getByRole("button", { name: /First Cafe/ }).click();
  await page.getByRole("button", { name: "Try a sample receipt" }).click();
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByRole("button", { name: /Second Cafe/ }).click();
  const confirmation = page.getByRole("dialog", {
    name: "Move to a different table?",
  });
  await expect(confirmation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirmation).not.toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Good food has a home." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Second Cafe/ }).click();
  await confirmation
    .getByRole("button", { name: "Change restaurant", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".restaurant-bar strong")).toHaveText(
    "Second Cafe",
  );
  await expect(page.getByLabel("Item 1 name")).not.toBeVisible();
});

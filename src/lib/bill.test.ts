import test from "node:test";
import assert from "node:assert/strict";
import {
  allocate,
  demoBill,
  emptyBill,
  isBill,
  splitBill,
  toMinor,
} from "./bill";
import { canSplit, type Restaurant } from "./restaurants";

test("largest remainder allocation preserves every cent with deterministic ties", () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(1, [0, 1, 1]), [0, 1, 0]);
  assert.deepEqual(allocate(200, [0, 0]), [0, 0]);
});

test("shared plates reconcile to item totals only", () => {
  const result = splitBill(demoBill());
  assert.equal(result.total, 3600);
  assert.equal(result.unassigned, 0);
  assert.deepEqual(
    result.people.map((p) => p.total),
    [992, 992, 1616],
  );
  assert.equal(
    result.people.reduce((sum, p) => sum + p.total, 0),
    result.total,
  );
});

test("old drafts with tax or tip fields still split only item amounts", () => {
  const legacyBill = { ...demoBill(), tax: 396, tip: 540 };
  assert.equal(isBill(legacyBill), true);
  assert.deepEqual(splitBill(legacyBill), splitBill(demoBill()));
});

test("equal split preserves a single cent across three people", () => {
  const bill = demoBill();
  bill.mode = "equal";
  bill.items = [
    { id: "tiny", name: "Item", amount: 1, quantity: 1, personIds: [] },
  ];
  assert.deepEqual(
    splitBill(bill).people.map((p) => p.total),
    [1, 0, 0],
  );
});

test("removed people leave unassigned items without losing money", () => {
  const bill = demoBill();
  bill.people = bill.people.filter((p) => p.id !== "jad");
  const result = splitBill(bill);
  assert.equal(result.unassigned, 1400);
  assert.equal(
    result.people.reduce((sum, p) => sum + p.total, result.unassigned),
    result.total,
  );
});

test("empty bills and groups without people reconcile", () => {
  assert.equal(splitBill(emptyBill()).people[0].total, 0);
  const bill = demoBill();
  bill.people = [];
  assert.equal(splitBill(bill).unassigned, 3600);
});

test("amounts use the configured currency precision and reject nonfinite values", () => {
  assert.equal(toMinor("12.34", "USD"), 1234);
  assert.equal(toMinor("125000", "LBP"), 125000);
  assert.equal(toMinor("-10", "USD"), 0);
  assert.equal(toMinor("Infinity", "USD"), 0);
  assert.equal(isBill(demoBill()), true);
  assert.equal(
    isBill({ ...demoBill(), items: [{ ...demoBill().items[0], amount: -1 }] }),
    false,
  );
  assert.equal(isBill({ ...demoBill(), items: [null] }), false);
  assert.equal(
    isBill({
      ...demoBill(),
      people: [
        { id: "x", name: "One" },
        { id: "x", name: "Two" },
      ],
    }),
    false,
  );
});

test("many large and small bills reconcile exactly in both modes", () => {
  for (let count = 1; count <= 17; count++) {
    for (const mode of ["items", "equal"] as const) {
      const bill = emptyBill();
      bill.mode = mode;
      bill.people = Array.from({ length: count }, (_, i) => ({
        id: `${i}`,
        name: `${i}`,
      }));
      bill.items = Array.from({ length: 25 }, (_, i) => ({
        id: `${i}`,
        name: "Item",
        amount: (i * 987651 + count) % 1_000_000_000,
        quantity: 1,
        personIds: bill.people
          .filter((_, p) => (p + i) % 3 !== 0)
          .map((p) => p.id),
      }));
      const result = splitBill(bill);
      assert.equal(
        result.people.reduce((sum, p) => sum + p.total, result.unassigned),
        result.total,
      );
      assert.ok(
        result.people.every(
          (p) => Number.isSafeInteger(p.total) && p.total >= 0,
        ),
      );
      if (mode === "equal")
        assert.ok(
          Math.max(...result.people.map((p) => p.total)) -
            Math.min(...result.people.map((p) => p.total)) <=
            1,
        );
    }
  }
});

test("restaurant availability requires active, enabled, unexpired access", () => {
  const restaurant: Restaurant = {
    id: "test",
    slug: "test",
    name: "Test",
    city: "Beirut",
    status: "active",
    splitting_enabled: true,
    split_access_expires_at: null,
  };
  assert.equal(canSplit(restaurant), true);
  assert.equal(canSplit({ ...restaurant, status: "pending" }), false);
  assert.equal(canSplit({ ...restaurant, splitting_enabled: false }), false);
  assert.equal(
    canSplit({ ...restaurant, split_access_expires_at: "2020-01-01" }),
    false,
  );
});

export type Person = { id: string; name: string };
export type BillItem = {
  id: string;
  name: string;
  quantity: number;
  amount: number;
  personIds: string[];
};
export type Currency = "USD" | "LBP";
export type Bill = {
  title: string;
  currency: Currency;
  people: Person[];
  items: BillItem[];
  mode: "items" | "equal";
};

export const currencyDigits = (currency: Currency) =>
  currency === "LBP" ? 0 : 2;
export const money = (amount: number, currency: Currency) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: currencyDigits(currency),
    maximumFractionDigits: currencyDigits(currency),
  }).format(amount / 10 ** currencyDigits(currency));

export function toMinor(value: string, currency: Currency): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(
        0,
        Math.min(
          1_000_000_000,
          Math.round(parsed * 10 ** currencyDigits(currency)),
        ),
      )
    : 0;
}

// Largest remainder allocation keeps the sum exact, including a one-cent split.
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) return weights.map(() => 0);
  const divisor = BigInt(total);
  const numerators = weights.map((weight) => BigInt(amount) * BigInt(weight));
  const result = numerators.map((value) => Number(value / divisor));
  const order = numerators
    .map((value, index) => ({ index, remainder: value % divisor }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.index - b.index
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  let left = amount - result.reduce((a, b) => a + b, 0);
  for (const { index } of order) {
    if (left-- <= 0) break;
    result[index]++;
  }
  return result;
}

export function splitBill(bill: Bill) {
  const total = bill.items.reduce((sum, item) => sum + item.amount, 0);
  const shares = bill.people.map(() => 0);
  let unassigned = 0;
  if (bill.mode === "equal") {
    allocate(
      total,
      bill.people.map(() => 1),
    ).forEach((share, i) => (shares[i] = share));
    if (!bill.people.length) unassigned = total;
  } else {
    bill.items.forEach((item) => {
      const weights = bill.people.map((person) =>
        item.personIds.includes(person.id) ? 1 : 0,
      );
      if (!weights.some(Boolean)) {
        unassigned += item.amount;
        return;
      }
      allocate(item.amount, weights).forEach(
        (share, i) => (shares[i] += share),
      );
    });
  }
  return {
    total,
    unassigned,
    people: bill.people.map((person, i) => ({ ...person, total: shares[i] })),
  };
}

export function emptyBill(): Bill {
  return {
    title: "Dinner with friends",
    currency: "USD",
    people: [{ id: "you", name: "You" }],
    items: [],
    mode: "items",
  };
}

export function demoBill(): Bill {
  return {
    title: "A little taste of Beirut",
    currency: "USD",
    mode: "items",
    people: [
      { id: "you", name: "You" },
      { id: "maya", name: "Maya" },
      { id: "jad", name: "Jad" },
    ],
    items: [
      {
        id: "hummus",
        name: "Hummus & warm pita",
        quantity: 1,
        amount: 650,
        personIds: ["you", "maya", "jad"],
      },
      {
        id: "fattoush",
        name: "Fattoush salad",
        quantity: 1,
        amount: 750,
        personIds: ["you", "maya"],
      },
      {
        id: "taouk",
        name: "Shish taouk",
        quantity: 1,
        amount: 1400,
        personIds: ["jad"],
      },
      {
        id: "lemonade",
        name: "Mint lemonade",
        quantity: 2,
        amount: 800,
        personIds: ["you", "maya"],
      },
    ],
  };
}

export function isBill(value: unknown): value is Bill {
  if (!value || typeof value !== "object") return false;
  const b = value as Bill;
  const amount = (v: unknown) =>
    typeof v === "number" &&
    Number.isSafeInteger(v) &&
    v >= 0 &&
    v <= 1_000_000_000;
  return (
    typeof b.title === "string" &&
    ["USD", "LBP"].includes(b.currency) &&
    ["items", "equal"].includes(b.mode) &&
    Array.isArray(b.people) &&
    b.people.length <= 50 &&
    b.people.every(
      (p) => p && typeof p.id === "string" && typeof p.name === "string",
    ) &&
    new Set(b.people.map((p) => p.id)).size === b.people.length &&
    Array.isArray(b.items) &&
    b.items.length <= 500 &&
    b.items.every(
      (i) =>
        i &&
        typeof i.id === "string" &&
        typeof i.name === "string" &&
        amount(i.amount) &&
        Number.isInteger(i.quantity) &&
        i.quantity > 0 &&
        i.quantity <= 999 &&
        Array.isArray(i.personIds) &&
        i.personIds.every((id) => typeof id === "string"),
    )
  );
}

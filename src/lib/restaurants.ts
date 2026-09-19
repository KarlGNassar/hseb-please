export type Restaurant = {
  id: string;
  slug: string;
  name: string;
  city: string;
  status: "pending" | "active" | "suspended";
  splitting_enabled: boolean;
  split_access_expires_at: string | null;
};

// This is only a UI hint. The server checks the database again for every split.
export function canSplit(restaurant: Restaurant, now = Date.now()) {
  return (
    restaurant.status === "active" &&
    restaurant.splitting_enabled &&
    (!restaurant.split_access_expires_at ||
      Date.parse(restaurant.split_access_expires_at) > now)
  );
}

import "server-only";

export function requiresRegisteredRestaurant() {
  const value = process.env.HSEB_REQUIRE_REGISTERED_RESTAURANT;
  if (value && value !== "true" && value !== "false") {
    throw new Error(
      "HSEB_REQUIRE_REGISTERED_RESTAURANT must be true or false.",
    );
  }
  return value === "true";
}

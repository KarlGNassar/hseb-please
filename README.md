# Hseb Please

Receipt scanning and fair bill splitting, with a little Lebanese soul. Built with Next.js 16 App Router, React, TypeScript, OCR.Space, and Supabase. Uses pnpm.

## Run the first release

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
# Set OCR_SPACE_API_KEY in .env.local before scanning receipts.
pnpm dev
```

Open http://localhost:3000. Node.js 20.9+ is required; Node.js 24 LTS is recommended. **No Supabase credentials are required for the initial free release.**

Customers can upload an image or use a phone camera, review OCR results, add/remove people, assign shared items or split equally, and copy/download the result. Tax, tips, and service charges are excluded from the split. English + Arabic is the default OCR mode (Engine 3 with automatic language detection); English-only uses Engine 2. Only USD and LBP are supported; changing currency manually relabels amounts rather than converting exchange rates. Currency changes and replacing or clearing an existing bill use in-app confirmation modals.

The first release works for **every customer at every restaurant**. There are no customer accounts, fees, payment collection, registration requests, notifications, or restaurant outreach.

## OCR.Space setup and Vercel deployment

Add `OCR_SPACE_API_KEY` to `.env.local` and the Vercel environment for each deployment, then redeploy. This is a **server-only** secret: do not prefix it with `NEXT_PUBLIC_`. Manual entry and sample bills work without a key. Supabase configuration is unchanged.

The default Arabic/English mode uses `OCREngine=3`, `language=auto`, and table detection. Engine 3 has its own free quota (currently 2,500 conversions/month); English-only mode uses Engine 2 (25,000/month). The free plan has a 1 MB file limit and a 500-request/day/IP limit. Check [current provider limits](https://ocr.space/ocrapi) before launch. The app accepts original phone photos up to 12 MB and compresses them locally before uploading.

Requests time out after 50 seconds. Failed or partial scans preserve existing bill items and offer manual entry. The endpoint validates image data, rejects URLs/file paths, checks restaurant eligibility when gating is enabled, and applies a best-effort five-scans/minute/IP limit per server instance. This is not a distributed quota; provider limits still apply across Vercel instances.

The pnpm patch in `patches/` removes the wrapper's raw error logging, which could otherwise expose API keys and image data in server logs. Commit `pnpm-workspace.yaml`, the patch, and the lockfile together.

## Restaurant access toggle

Copy `.env.example` to `.env.local`. Keep the following setting for the free launch:

```dotenv
HSEB_REQUIRE_REGISTERED_RESTAURANT=false
```

To restrict splitting to registered restaurants later, configure Supabase and set it to `true`. Restart/redeploy the app after changing it. This setting is **server-only**. The page reads it at runtime, and `/api/split` independently enforces it for every request.

When enabled:

- Customers select a restaurant from the directory or open `/?restaurant=restaurant-slug` (a URL that can be encoded into a QR code).
- A restaurant must have `status = 'active'`, `splitting_enabled = true`, and no expired `split_access_expires_at`.
- Pending, suspended, missing, disabled, and expired restaurants cannot split bills. An unavailable database also blocks splitting.
- Customers only see an explanation to wait. The app sends no notifications or registration requests. You manage restaurants and subscriptions yourself.

The directory/link establishes which restaurant the customer selected; it does **not** prove that an uploaded receipt came from that restaurant. OCR merchant matching is not an authentication mechanism. Signed, restaurant-issued bill/session links would be a separate feature if stronger enforcement becomes necessary.

## What is needed from Supabase

1. Your **project URL**.
2. Your **publishable API key** (a legacy anon key also works).
3. Run [`supabase/migrations/202609190001_restaurants.sql`](supabase/migrations/202609190001_restaurants.sql) using the Supabase SQL editor, or apply it through your usual Supabase migration workflow.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
HSEB_REQUIRE_REGISTERED_RESTAURANT=true
```

No service-role key, database password, or privileged secret is required by the application. Do not commit `.env.local`. The migration enables RLS and grants customers read-only access to the public restaurant directory. Customers cannot create restaurants or change access settings. Manage those through the Supabase dashboard / trusted SQL.

Example of **manually activating a restaurant** after you have checked its registration/subscription:

```sql
insert into public.restaurants (slug, name, city, status, splitting_enabled)
values ('your-restaurant', 'Your Restaurant', 'Beirut', 'active', true);

-- Optional: expire access at a specific subscription boundary.
update public.restaurants
set split_access_expires_at = '2026-12-31T23:59:59Z'
where slug = 'your-restaurant';

-- Disable access when needed.
update public.restaurants
set splitting_enabled = false
where slug = 'your-restaurant';
```

The migration contains no pre-approved example restaurants. Future restaurant billing can update these entitlements through a trusted webhook. Payment provider integration, checkout, subscription synchronization, restaurant accounts, and a restaurant management dashboard are **not implemented**. Keep private billing details in separate protected Supabase tables; the current restaurant table is public directory data.

## Data and calculations

- The browser prepares a JPEG under 900 KB and sends it to `/api/ocr`. The Next.js server calls OCR.Space with a private API key. Receipt images are processed in memory, are not stored by this app or Supabase, and are transmitted to OCR.Space. See the [provider privacy policy](https://ocr.space/privacypolicy). Internet access is required.
- Photos are cropped and straightened locally before OCR. Engine 3 reads mixed Arabic/English text and tables; Markdown table output is normalized into item rows. Engine 2 word positions help reconstruct English receipt rows. Restaurant headings, separator sections, and Arabic quantity placement are handled by the receipt parser.
- On dual-currency receipts, item amounts are compared with labeled LBP/USD totals to identify their currency. The USD equivalent is never added as an item. A subtotal (or a same-currency total without separate charges) provides a cross-check; amounts are never silently adjusted to match it.
- A single current bill draft is saved in `localStorage`, including item names, amounts, participant names, and the selected restaurant. Receipt images and raw OCR text are not persisted. Clearing browser data removes the draft. There is no cross-device sync.
- The final bill data is sent to the Next.js split endpoint for calculation and eligibility checks. It is not stored in a database. All persistent server-side data uses Supabase.
- Values are integer minor currency units. Shared items use largest-remainder allocation with exact integer arithmetic. Equal mode allocates the grand total evenly, with a maximum difference of one minor unit.
- Each item amount is its **line total**, already including quantity. Quantity is descriptive and never multiplies that total again.
- OCR is a heuristic, not an invoice parser with guaranteed accuracy. Review every scan. Unsupported discount lines are skipped and a detected-subtotal mismatch is highlighted; correct affected item totals manually. Complex layouts and poor photos may require manual entry. PDF and HEIC upload are not supported.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
# Optional live OCR check (uses your OCR.Space key and quota):
TEST_LIVE_OCR=1 pnpm test:e2e tests/ocr.spec.ts --project=desktop
# Optional regression check using the locally provided Koukh El Sabaya photo:
TEST_RECEIPT_IMAGE="/path/to/receipt.jpeg" pnpm test:e2e tests/ocr.spec.ts --project=desktop
```

Browser tests use the production build and run free/restricted modes on ports 3100/3101. They verify mobile/desktop flows, persistence, exact totals, input validation, and fail-closed access enforcement without a Supabase connection. Live Supabase migration/RLS verification requires your project. OCR accuracy also depends on the actual receipt image and language.

TypeScript 6 and ESLint 9 are pinned to the versions supported by the current Next.js lint plugins; the newer ESLint major is not yet compatible with those plugins.

## Project structure

- `src/app`: server-rendered page, metadata, styles, and API route handlers.
- `src/components/bill-workspace.tsx`: interactive scan/review/assignment workflow.
- `src/lib/bill.ts`: validated bill model and deterministic calculations.
- `src/lib/receipt.ts`: OCR text parsing.
- `src/lib/receipt-image.ts`: local receipt boundary detection and perspective correction.
- `src/lib/access-policy.ts`: server-only release toggle.
- `src/lib/supabase.ts`: server-only Supabase client using the public key and RLS.
- `supabase/migrations`: database schema and eligibility function.

Design references: [Next.js App Router](https://nextjs.org/docs/app/getting-started), [OCR.Space wrapper](https://github.com/DavideViolante/ocr-space-api-wrapper), [Supabase API keys](https://supabase.com/docs/guides/api/api-keys), and [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

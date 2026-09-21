import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

test("OCR endpoint keeps keys server-side, selects bilingual engine, and rejects failures", async (t) => {
  const wrapper = createRequire(import.meta.url)("ocr-space-api-wrapper");
  const calls: { image: string; options: Record<string, unknown> }[] = [];
  let fail = false;
  t.mock.method(
    wrapper,
    "ocrSpace",
    async (image: string, options: Record<string, unknown>) => {
      calls.push({ image, options });
      if (fail) throw new Error("private-test-key must not leak");
      return {
        OCRExitCode: 1,
        ParsedResults: [
          { FileParseExitCode: 1, ParsedText: "Cafe\nCoffee 3.00\nTotal 3.00" },
        ],
      };
    },
  );
  const { POST } = await import("../app/api/ocr/route");
  process.env.OCR_SPACE_API_KEY = "private-test-key";
  process.env.HSEB_REQUIRE_REGISTERED_RESTAURANT = "false";
  const image = "data:image/jpeg;base64,/9j/2Q==";
  const request = (language = "eng+ara", origin = "https://hseb.test") =>
    new Request("http://internal-next-server/api/ocr", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin,
        host: "hseb.test",
      },
      body: JSON.stringify({ image, language }),
    });
  let response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).text, "Cafe\nCoffee 3.00\nTotal 3.00");
  assert.equal(calls[0].options.apiKey, "private-test-key");
  assert.equal(calls[0].options.OCREngine, "3");
  assert.equal(calls[0].options.language, "auto");
  assert.equal(calls[0].options.isOverlayRequired, false);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal((await POST(request("eng"))).status, 200);
  assert.equal(calls[1].options.OCREngine, "2");
  assert.equal((await POST(request("eng", "https://other.test"))).status, 403);
  process.env.HSEB_REQUIRE_REGISTERED_RESTAURANT = "true";
  assert.equal((await POST(request())).status, 403);
  process.env.HSEB_REQUIRE_REGISTERED_RESTAURANT = "false";
  delete process.env.OCR_SPACE_API_KEY;
  assert.equal((await POST(request())).status, 503);
  assert.equal(calls.length, 2);
  process.env.OCR_SPACE_API_KEY = "private-test-key";
  fail = true;
  response = await POST(request());
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes("private-test-key"));
  fail = false;
  await POST(request());
  await POST(request());
  assert.equal((await POST(request())).status, 429);
  assert.equal(calls.length, 5);
});

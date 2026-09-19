type Point = { x: number; y: number };
export type ReceiptCorners = [Point, Point, Point, Point];

/** Detect long dashed rules even when Tesseract omits them from its text output. */
export function findReceiptSeparators(canvas: HTMLCanvasElement): number[] {
  const thumbnail = document.createElement("canvas");
  thumbnail.width = Math.min(360, canvas.width);
  thumbnail.height = Math.round(
    (canvas.height * thumbnail.width) / canvas.width,
  );
  const context = thumbnail.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
  const { data } = context.getImageData(
    0,
    0,
    thumbnail.width,
    thumbnail.height,
  );
  const margin = Math.round(thumbnail.width * 0.05);
  const bands: { start: number; end: number }[] = [];
  for (let y = 3; y < thumbnail.height - 3; y++) {
    let dark = 0;
    for (let x = margin; x < thumbnail.width - margin; x++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (data[((y + dy) * thumbnail.width + x) * 4] < 110) {
          dark++;
          break;
        }
      }
    }
    if (dark / (thumbnail.width - margin * 2) > 0.55) {
      const last = bands[bands.length - 1];
      if (last && last.end === y - 1) last.end = y;
      else bands.push({ start: y, end: y });
    }
  }
  return bands
    .filter((band) => band.end - band.start < thumbnail.height * 0.025)
    .map(
      (band) =>
        (((band.start + band.end) / 2) * canvas.height) / thumbnail.height,
    );
}

/** Find the largest connected region of light, low-saturation receipt paper. */
export function findReceiptCorners(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): ReceiptCorners | null {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const r = pixels[i * 4],
      g = pixels[i * 4 + 1],
      b = pixels[i * 4 + 2];
    mask[i] =
      Math.min(r, g, b) > 110 && Math.max(r, g, b) - Math.min(r, g, b) < 48
        ? 1
        : 0;
  }
  const queue = new Int32Array(mask.length);
  let largest = 0;
  let best: ReceiptCorners | null = null;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start]) continue;
    let head = 0,
      tail = 1;
    queue[0] = start;
    mask[start] = 0;
    const corners: ReceiptCorners = [
      { x: width, y: height },
      { x: 0, y: height },
      { x: 0, y: 0 },
      { x: width, y: 0 },
    ];
    while (head < tail) {
      const index = queue[head++],
        x = index % width,
        y = Math.floor(index / width);
      if (x + y < corners[0].x + corners[0].y) corners[0] = { x, y };
      if (x - y > corners[1].x - corners[1].y) corners[1] = { x, y };
      if (x + y > corners[2].x + corners[2].y) corners[2] = { x, y };
      if (x - y < corners[3].x - corners[3].y) corners[3] = { x, y };
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ];
      for (const next of neighbors)
        if (next >= 0 && mask[next]) {
          mask[next] = 0;
          queue[tail++] = next;
        }
    }
    if (tail > largest) {
      largest = tail;
      best = corners;
    }
  }
  if (!best || largest < mask.length * 0.18) return null;
  const [tl, tr, br, bl] = best;
  if (
    tr.x - tl.x < width * 0.2 ||
    br.x - bl.x < width * 0.2 ||
    bl.y - tl.y < height * 0.25 ||
    br.y - tr.y < height * 0.25
  )
    return null;
  return best;
}

/** Perspective mapping from a unit square into the photographed quadrilateral. */
export function receiptTransform([tl, tr, br, bl]: ReceiptCorners) {
  const dx1 = tr.x - br.x,
    dx2 = bl.x - br.x,
    dx3 = tl.x - tr.x + br.x - bl.x;
  const dy1 = tr.y - br.y,
    dy2 = bl.y - br.y,
    dy3 = tl.y - tr.y + br.y - bl.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  const g = determinant ? (dx3 * dy2 - dx2 * dy3) / determinant : 0;
  const h = determinant ? (dx1 * dy3 - dx3 * dy1) / determinant : 0;
  const a = tr.x - tl.x + g * tr.x,
    b = bl.x - tl.x + h * bl.x;
  const d = tr.y - tl.y + g * tr.y,
    e = bl.y - tl.y + h * bl.y;
  return (u: number, v: number): Point => {
    const denominator = g * u + h * v + 1;
    return {
      x: (a * u + b * v + tl.x) / denominator,
      y: (d * u + e * v + tl.y) / denominator,
    };
  };
}

/** All preparation happens locally. Fall back to the full image if paper is uncertain. */
export async function prepareReceiptImage(
  file: File,
): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  try {
    const source = document.createElement("canvas");
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    source.width = Math.round(bitmap.width * scale);
    source.height = Math.round(bitmap.height * scale);
    const context = source.getContext("2d", { willReadFrequently: true })!;
    context.fillStyle = "white";
    context.fillRect(0, 0, source.width, source.height);
    context.drawImage(bitmap, 0, 0, source.width, source.height);
    const thumbnail = document.createElement("canvas");
    thumbnail.width = Math.min(360, source.width);
    thumbnail.height = Math.round(
      (source.height * thumbnail.width) / source.width,
    );
    const thumbnailContext = thumbnail.getContext("2d", {
      willReadFrequently: true,
    })!;
    thumbnailContext.drawImage(source, 0, 0, thumbnail.width, thumbnail.height);
    const found = findReceiptCorners(
      thumbnailContext.getImageData(0, 0, thumbnail.width, thumbnail.height)
        .data,
      thumbnail.width,
      thumbnail.height,
    );
    const factor = source.width / thumbnail.width;
    const corners = found?.map((point) => ({
      x: point.x * factor,
      y: point.y * factor,
    })) as ReceiptCorners | undefined;
    if (!corners) return source;
    const [tl, tr, br, bl] = corners;
    const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
    const width = Math.max(distance(tl, tr), distance(bl, br));
    const height = Math.max(distance(tl, bl), distance(tr, br));
    const upscale = Math.min(2, 2200 / Math.max(width, height));
    const output = document.createElement("canvas");
    const border = 20;
    const innerWidth = Math.round(width * upscale),
      innerHeight = Math.round(height * upscale);
    output.width = innerWidth + border * 2;
    output.height = innerHeight + border * 2;
    const out = output.getContext("2d")!;
    const input = context.getImageData(0, 0, source.width, source.height).data;
    const result = out.createImageData(output.width, output.height);
    result.data.fill(255);
    const map = receiptTransform(corners);
    for (let y = 0; y < innerHeight; y++) {
      for (let x = 0; x < innerWidth; x++) {
        const point = map(x / (innerWidth - 1), y / (innerHeight - 1));
        const sx = Math.max(0, Math.min(source.width - 2, point.x)),
          sy = Math.max(0, Math.min(source.height - 2, point.y));
        const ix = Math.floor(sx),
          iy = Math.floor(sy),
          fx = sx - ix,
          fy = sy - iy;
        const at = (iy * source.width + ix) * 4;
        const target = ((y + border) * output.width + x + border) * 4;
        let luminance = 0;
        for (let c = 0; c < 3; c++) {
          const value =
            input[at + c] * (1 - fx) * (1 - fy) +
            input[at + 4 + c] * fx * (1 - fy) +
            input[at + source.width * 4 + c] * (1 - fx) * fy +
            input[at + (source.width + 1) * 4 + c] * fx * fy;
          luminance += value * [0.299, 0.587, 0.114][c];
        }
        const gray = Math.max(0, Math.min(255, (luminance - 30) * 1.15));
        result.data[target] =
          result.data[target + 1] =
          result.data[target + 2] =
            gray;
      }
    }
    out.putImageData(result, 0, 0);
    return output;
  } finally {
    bitmap.close();
  }
}

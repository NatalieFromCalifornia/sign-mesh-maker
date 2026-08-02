import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// __dirname rather than import.meta: the repo root is CommonJS.
const fixture = (name: string) => path.join(__dirname, 'fixtures', name);

async function upload(page: Page, name: string) {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixture(name));
  await expect(page.getByRole('button', { name: /generate mesh/i })).toBeVisible();
}

async function generate(page: Page) {
  await page.getByRole('button', { name: /generate mesh/i }).click();
  await expect(page.getByText(/triangles/)).toBeVisible({ timeout: 30_000 });
}

test('uploads an SVG, lists a layer per colour, and previews the artwork', async ({ page }) => {
  await upload(page, 'sign-4-colors.svg');

  await expect(page.getByText('Layers · 4')).toBeVisible();
  // Hex is lowercase in the DOM; the uppercase is a CSS transform.
  for (const hex of ['#2f9d8f', '#f2681c', '#e7edec', '#4d7fbe']) {
    await expect(page.getByText(hex, { exact: true })).toBeVisible();
  }

  // Artwork is drawn from parsed geometry, one group per layer.
  await expect(page.locator('svg[role=img] > g')).toHaveCount(4);
});

test('assigns heights as base + n × step', async ({ page }) => {
  await upload(page, 'sign-4-colors.svg');

  // Defaults: base 2 mm, step 0.4 mm.
  for (const height of ['2.00 mm', '2.40 mm', '2.80 mm', '3.20 mm']) {
    await expect(page.getByText(height, { exact: true })).toBeVisible();
  }
});

test('keeps decimal-percentage fills distinct', async ({ page }) => {
  // Cairo-style fills once collapsed to a single white layer.
  await upload(page, 'cairo-percent.svg');

  await expect(page.getByText('Layers · 3')).toBeVisible();
  await expect(page.getByText('#ffffff', { exact: true })).toHaveCount(0);
});

test('renders the mesh into a correctly sized canvas', async ({ page }) => {
  await upload(page, 'sign-4-colors.svg');
  await generate(page);

  const metrics = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const host = canvas.parentElement!;
    const rect = canvas.getBoundingClientRect();
    return {
      dpr: window.devicePixelRatio,
      cssWidth: Math.round(rect.width),
      cssHeight: Math.round(rect.height),
      hostWidth: host.clientWidth,
      hostHeight: host.clientHeight,
      bufferWidth: canvas.width,
      hasContext: !!(canvas.getContext('webgl2') || canvas.getContext('webgl')),
    };
  });

  /*
   * The regression this guards: with the CSS size left unset, the canvas laid
   * out at its buffer size, grew its container, and re-triggered the resize
   * observer until the buffer ran to millions of pixels and WebGL gave up.
   */
  expect(metrics.cssWidth).toBe(metrics.hostWidth);
  expect(metrics.cssHeight).toBe(metrics.hostHeight);
  expect(metrics.bufferWidth).toBe(Math.round(metrics.cssWidth * metrics.dpr));
  expect(metrics.bufferWidth).toBeLessThan(10_000);
  expect(metrics.hasContext).toBe(true);
});

test('mesh generation is explicit, never reactive to config edits', async ({ page }) => {
  await upload(page, 'sign-4-colors.svg');
  await generate(page);

  await page.getByRole('button', { name: 'Increase Width' }).click();

  // Requirements §5.6: config changes must not silently rebuild the mesh.
  await expect(page.getByText(/regenerate to apply/i)).toBeVisible();
});

test('number fields can be cleared and retyped', async ({ page }) => {
  await upload(page, 'sign-4-colors.svg');
  const width = page.getByRole('spinbutton', { name: 'Width' });

  // Binding a raw number here made backspace a no-op and typing append-only.
  await width.click();
  await width.press('End');
  await width.press('Backspace');
  await width.press('Backspace');
  await width.press('Backspace');
  await expect(width).toHaveValue('');

  await width.pressSequentially('85');
  await expect(width).toHaveValue('85');
});

test('steppers nudge by the step without floating-point drift', async ({ page }) => {
  await upload(page, 'sign-4-colors.svg');
  const layerStep = page.getByRole('spinbutton', { name: 'Layer step' });

  await expect(layerStep).toHaveValue('0.4');
  await page.getByRole('button', { name: 'Increase Layer step' }).click();
  await expect(layerStep).toHaveValue('0.5');
  await page.getByRole('button', { name: 'Increase Layer step' }).click();
  await expect(layerStep).toHaveValue('0.6');
});

test('exports a well-formed binary STL that sits on the bed', async ({ page }) => {
  await upload(page, 'sign-4-colors.svg');
  await generate(page);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /download stl/i }).click(),
  ]);

  const path = await download.path();
  const buffer = readFileSync(path);

  const triangles = buffer.readUInt32LE(80);
  expect(triangles).toBeGreaterThan(0);
  // Binary STL is an 84-byte header plus 50 bytes per triangle, exactly.
  expect(buffer.length).toBe(84 + triangles * 50);

  let minUp = Infinity;
  let maxUp = -Infinity;
  for (let i = 0; i < triangles; i++) {
    const offset = 84 + i * 50 + 12;
    for (let v = 0; v < 3; v++) {
      const up = buffer.readFloatLE(offset + v * 12 + 4);
      minUp = Math.min(minUp, up);
      maxUp = Math.max(maxUp, up);
    }
  }
  expect(minUp).toBeCloseTo(0, 3);
  expect(maxUp).toBeCloseTo(3.2, 2);
});

test('reports a corrupt image rather than failing silently', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', {
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not really a png'),
  });

  await expect(page.getByRole('alert')).toContainText(/could not be decoded/i);
});

test('rejects file types the pipeline cannot handle', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', {
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  });

  await expect(page.getByRole('alert')).toContainText(/unsupported file/i);
});

test('traces a raster upload and retraces as the colour count changes', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixture('photo-4-colors.png'));

  // Tracing is the near-live loop of §9.1; it runs without a button press.
  await expect(page.getByRole('button', { name: /generate mesh/i })).toBeVisible({
    timeout: 30_000,
  });

  const swatches = page.locator('span[title^="#"]');
  await expect(swatches.first()).toBeVisible();

  // Palette is deduplicated: flat artwork converges below the requested count,
  // and repeated swatches would promise colours that never print.
  const titles = await swatches.evaluateAll((els) =>
    els.map((e) => e.getAttribute('title')),
  );
  expect(new Set(titles).size).toBe(titles.length);

  const layerRows = page.locator('li').filter({ hasText: /#[0-9a-f]{6}/i });
  const atEight = await layerRows.count();
  expect(atEight).toBeGreaterThan(0);

  await page.getByRole('spinbutton', { name: 'Colors' }).fill('3');
  await expect
    .poll(async () => layerRows.count(), { timeout: 30_000 })
    .toBeLessThanOrEqual(atEight);
});

test('builds a mesh from a traced raster', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixture('photo-4-colors.png'));
  await expect(page.getByRole('button', { name: /generate mesh/i })).toBeVisible({
    timeout: 30_000,
  });

  await generate(page);
  await expect(page.getByText(/triangles/)).toBeVisible();
});

test('recolours a layer', async ({ page }) => {
  await upload(page, 'sign-4-colors.svg');
  const rows = page.locator('li').filter({ hasText: /#[0-9a-f]{6}/i });

  await page.locator('input[type=color]').first().fill('#ff0000');
  await expect(rows.first()).toContainText('#ff0000');
});

test('merges selected layers into one at a shared height', async ({ page }) => {
  await upload(page, 'sign-4-colors.svg');
  const rows = page.locator('li').filter({ hasText: /#[0-9a-f]{6}/i });
  await expect(rows).toHaveCount(4);

  await page.locator('input[type=checkbox]').nth(0).check();
  await page.locator('input[type=checkbox]').nth(1).check();
  await page.getByRole('button', { name: 'Merge' }).click();

  // §5.4: layers sharing a colour become one printed layer, not two at one height.
  await expect(rows).toHaveCount(3);
  await expect(page.getByText('2 merged')).toBeVisible();

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(rows).toHaveCount(4);
});

test('merging reduces the height of the generated mesh', async ({ page }) => {
  await upload(page, 'sign-4-colors.svg');
  const stats = page.getByText(/triangles/);

  await generate(page);
  // Four layers on a 2mm base at 0.4mm steps top out at 3.20mm.
  await expect(stats).toContainText('3.20 mm');
  const before = (await stats.textContent()) ?? '';

  await page.locator('input[type=checkbox]').nth(0).check();
  await page.locator('input[type=checkbox]').nth(1).check();
  await page.getByRole('button', { name: 'Merge' }).click();
  await page.getByRole('button', { name: /regenerate mesh/i }).click();

  /*
   * Wait for the stats line to actually change. Waiting on "triangles" alone
   * would pass instantly — it is still on screen from the previous build.
   */
  await expect(stats).not.toHaveText(before);
  // Three layers now, so the stack is one step shorter.
  await expect(stats).toContainText('2.80 mm');
});

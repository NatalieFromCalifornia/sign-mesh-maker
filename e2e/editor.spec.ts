import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import path from 'node:path';

// __dirname rather than import.meta: the repo root is CommonJS.
const fixture = (name: string) => path.join(__dirname, 'fixtures', name);

async function upload(page: Page, name: string) {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixture(name));
  await expect(page.getByRole('button', { name: /generate mesh/i })).toBeVisible();
}

/** Layer checkboxes by label — positional lookup breaks when a control is added above. */
/**
 * Drags a crop handle by a fraction of the crop window.
 *
 * hover() first so the panel is scrolled into view: boundingBox() reports
 * viewport coordinates, and on a short viewport the crop panel sits below the
 * fold, where a raw mouse move lands on nothing.
 */
async function dragCropHandle(page: Page, handle: string, fractionOfWidth: number) {
  const target = page.locator(`[aria-label="Resize crop ${handle}"]`);
  await target.hover();

  const box = (await page.getByRole('group', { name: 'Crop window' }).boundingBox())!;
  const handleBox = (await target.boundingBox())!;
  const cx = handleBox.x + handleBox.width / 2;
  const cy = handleBox.y + handleBox.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + box.width * fractionOfWidth, cy, { steps: 12 });
  await page.mouse.up();
}

async function selectLayers(page: Page, ...indices: number[]) {
  const boxes = page.locator('input[aria-label^="Select layer"]');
  for (const index of indices) await boxes.nth(index).check();
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

  // Z is up: slicers expect it, and the preview's Y-up tilt is applied by the
  // viewer rather than baked into exports.
  let minUp = Infinity;
  let maxUp = -Infinity;
  for (let i = 0; i < triangles; i++) {
    const offset = 84 + i * 50 + 12;
    for (let v = 0; v < 3; v++) {
      const up = buffer.readFloatLE(offset + v * 12 + 8);
      minUp = Math.min(minUp, up);
      maxUp = Math.max(maxUp, up);
    }
  }
  expect(minUp).toBeCloseTo(0, 3);
  expect(maxUp).toBeCloseTo(3.2, 2);
});

test('rejects raster images with a specific reason', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', {
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not really a png'),
  });

  await expect(page.getByRole('alert')).toContainText(/only svg is supported/i);
});

test('rejects file types the pipeline cannot handle', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', {
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  });

  await expect(page.getByRole('alert')).toContainText(/only svg is supported/i);
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

  await selectLayers(page, 0, 1);
  await page.getByRole('button', { name: 'Merge' }).click();

  // §5.4: layers sharing a colour become one printed layer, not two at one height.
  await expect(rows).toHaveCount(3);
  await expect(page.getByText('2 merged')).toBeVisible();

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(rows).toHaveCount(4);
});

test('merging rebuilds the mesh without pressing the button', async ({ page }) => {
  await upload(page, 'sign-4-colors.svg');
  const stats = page.getByText(/triangles/);

  await generate(page);
  // Four layers on a 2mm base at 0.4mm steps top out at 3.20mm.
  await expect(stats).toContainText('3.20 mm');

  await selectLayers(page, 0, 1);
  await page.getByRole('button', { name: 'Merge' }).click();

  // No Regenerate click: a merge changes which layers exist, so leaving the old
  // mesh up would contradict the layer list. Three layers now, one step shorter.
  await expect(stats).toContainText('2.80 mm');
  await expect(page.getByText(/regenerate to apply/i)).toHaveCount(0);
});

test('dimension edits still wait for the button', async ({ page }) => {
  await upload(page, 'sign-4-colors.svg');
  const stats = page.getByText(/triangles/);

  await generate(page);
  const before = (await stats.textContent()) ?? '';

  await page.getByRole('button', { name: 'Increase Width' }).click();

  // §5.6: dimensions are fiddled with continuously and each rebuild costs a
  // full retriangulation, so these stay manual. The line reports the mesh that
  // exists, not the config that would produce the next one.
  await expect(page.getByText(/regenerate to apply/i)).toBeVisible();
  await expect(stats).toHaveText(before);
});

test('hovering a layer isolates it in both previews', async ({ page }) => {
  await upload(page, 'sign-4-colors.svg');
  await generate(page);
  await page.waitForTimeout(1200);

  const canvas = page.locator('canvas');
  const row = page.locator('li').filter({ hasText: /#[0-9a-f]{6}/i }).first();

  const plain = await canvas.screenshot();
  await row.hover();
  await page.waitForTimeout(500);
  const hovered = await canvas.screenshot();

  // Other layers fade back, so the rendered frame must differ.
  expect(Buffer.compare(plain, hovered)).not.toBe(0);

  // The flat preview dims the same layers.
  const opacities = await page
    .locator('svg[role=img] > g')
    .evaluateAll((groups) => groups.map((g) => g.getAttribute('opacity')));
  expect(opacities.filter((o) => o === '0.15').length).toBeGreaterThan(0);
});

test.describe('saving projects', () => {
  test('offers saving but gates it behind sign-in', async ({ page }) => {
    await upload(page, 'sign-4-colors.svg');

    // Name is seeded from the file so saving needs no typing.
    await expect(page.getByLabel('Name')).toHaveValue('sign-4-colors');
    await expect(page.getByRole('button', { name: /^save project$/i })).toBeDisabled();
    await expect(page.getByText(/sign in.*to save/i)).toBeVisible();
  });

  test('leaves export working without an account', async ({ page }) => {
    // §4: the whole pipeline runs anonymously; only saving is gated.
    await upload(page, 'sign-4-colors.svg');
    await generate(page);
    await expect(page.getByRole('button', { name: /download stl/i })).toBeEnabled();
  });

  test('asks a signed-out visitor to sign in before opening a project', async ({ page }) => {
    // The security rules would reject this read, so it never fires one.
    await page.goto('/?project=someprojectid');
    await expect(page.getByRole('alert')).toContainText(/sign in to open a saved project/i);
  });

  test('sends a signed-out visitor from the projects list to login', async ({ page }) => {
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('flat mode (§5.5)', () => {
  const enableFlat = (page: Page) =>
    page.locator('label:has-text("Flat mesh") input[type=checkbox]').check();

  test('puts every layer at one height', async ({ page }) => {
    await upload(page, 'sign-4-colors.svg');
    const rows = page.locator('li').filter({ hasText: /#[0-9a-f]{6}/i });

    // Stepped: 2.00 / 2.40 / 2.80 / 3.20.
    await expect(rows.first()).toContainText('2.00 mm');
    await expect(rows.last()).toContainText('3.20 mm');

    await enableFlat(page);

    const heights = await rows.evaluateAll((els) =>
      els.map((e) => e.textContent?.match(/[\d.]+ mm/)?.[0]),
    );
    expect(new Set(heights).size).toBe(1);
    expect(heights[0]).toBe('2.40 mm');
  });

  test('reveals the channel control and relabels the step field', async ({ page }) => {
    await upload(page, 'sign-4-colors.svg');
    await expect(page.getByRole('spinbutton', { name: 'Channel' })).toHaveCount(0);

    await enableFlat(page);
    await expect(page.getByRole('spinbutton', { name: 'Channel' })).toHaveValue('0.08');
    // "Layer step" no longer describes a stack that steps.
    await expect(page.getByRole('spinbutton', { name: 'Colour thickness' })).toBeVisible();
  });

  test('exports a flat STL grooved down to the base, not through it', async ({ page }) => {
    await upload(page, 'sign-4-colors.svg');
    await enableFlat(page);
    await generate(page);
    await expect(page.getByText(/2\.40 mm/).first()).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /download stl/i }).click(),
    ]);
    const buffer = readFileSync(await download.path());
    const triangles = buffer.readUInt32LE(80);
    expect(buffer.length).toBe(84 + triangles * 50);

    const heights = new Set<string>();
    for (let i = 0; i < triangles; i++) {
      const offset = 84 + i * 50 + 12;
      // Z, since exports are oriented for a print bed.
      for (let v = 0; v < 3; v++) heights.add(buffer.readFloatLE(offset + v * 12 + 8).toFixed(2));
    }

    /*
     * Three levels, and the middle one matters: the base at 2.00 proves the
     * channels are grooves in a solid slab rather than gaps to the print bed.
     */
    expect([...heights].map(Number).sort((a, b) => a - b)).toEqual(
      expect.arrayContaining([0, 2, 2.4]),
    );
  });
});

test.describe('crop (§5.3)', () => {
  test('crops the artwork and rescales the sign', async ({ page }) => {
    await upload(page, 'sign-4-colors.svg');
    const stats = page.getByText(/triangles/);
    await generate(page);
    // 200×120 artwork at 120mm wide.
    await expect(stats).toContainText('120 × 72.0');

    await page.getByRole('button', { name: 'Crop', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Crop window' })).toBeVisible();

    // Keep roughly the left half.
    await dragCropHandle(page, 'e', -0.5);

    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: /regenerate mesh/i }).click();

    // Half the width at the same height is a taller sign for a fixed width.
    await expect(stats).toContainText('120 × 144.0');
  });

  test('offers a reset only once the artwork is cropped', async ({ page }) => {
    await upload(page, 'sign-4-colors.svg');
    await page.getByRole('button', { name: 'Crop', exact: true }).click();

    const reset = page.getByRole('button', { name: 'Reset' });
    await expect(reset).toHaveCount(0);

    await dragCropHandle(page, 'e', -0.3);

    await expect(reset).toBeVisible();
    await reset.click();
    await expect(reset).toHaveCount(0);
  });
});

test.describe('export orientation and 3MF', () => {
  /** Min/max per axis across every vertex of a binary STL. */
  function stlExtents(buffer: Buffer) {
    const triangles = buffer.readUInt32LE(80);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < triangles; i++) {
      const base = 84 + i * 50 + 12;
      for (let v = 0; v < 3; v++) {
        for (let a = 0; a < 3; a++) {
          const value = buffer.readFloatLE(base + v * 12 + a * 4);
          lo[a] = Math.min(lo[a], value);
          hi[a] = Math.max(hi[a], value);
        }
      }
    }
    return { triangles, lo, hi };
  }

  test('exports STL with thickness along Z, resting on the bed', async ({ page }) => {
    await upload(page, 'sign-4-colors.svg');
    await generate(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /download stl/i }).click(),
    ]);
    const { triangles, lo, hi } = stlExtents(readFileSync(await download.path()));
    const spans = hi.map((v, i) => v - lo[i]);

    /*
     * Slicers treat Z as up. The preview tilts printer space into three.js's
     * Y-up world, and when that rotation reached the exporter the sign arrived
     * standing on its edge.
     */
    expect(spans[2]).toBeLessThan(spans[0]);
    expect(spans[2]).toBeLessThan(spans[1]);
    expect(lo[2]).toBeCloseTo(0, 3);
    expect(triangles).toBeGreaterThan(0);
  });

  test('exports a 3MF holding every colour as one aligned build item', async ({ page }) => {
    await upload(page, 'sign-4-colors.svg');
    await generate(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /download 3mf/i }).click(),
    ]);

    const files = unzipSync(readFileSync(await download.path()));
    expect(Object.keys(files).sort()).toEqual([
      '3D/3dmodel.model',
      '[Content_Types].xml',
      '_rels/.rels',
    ]);

    const xml = strFromU8(files['3D/3dmodel.model']);
    expect(xml).toContain('unit="millimeter"');

    // One material per colour, and one build item so the parts stay together.
    expect(xml.match(/<base /g)).toHaveLength(4);
    expect(xml.match(/<item objectid="\d+"\/>/g)).toHaveLength(1);
    expect(xml.match(/<component objectid="\d+"\/>/g)).toHaveLength(4);

    for (const hex of ['#2F9D8FFF', '#F2681CFF', '#E7EDECFF', '#4D7FBEFF']) {
      expect(xml).toContain(`displaycolor="${hex}"`);
    }

    // Positive octant, as 3MF expects of a build volume.
    const coords = [...xml.matchAll(/(?:x|y|z)="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.min(...coords)).toBeGreaterThanOrEqual(0);
  });
});

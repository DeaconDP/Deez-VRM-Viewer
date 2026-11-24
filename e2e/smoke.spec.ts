import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const FIXTURE = new URL('./fixtures/minimal.vrm', import.meta.url);
// Must match LEGAL_ACCEPTANCE_KEY / LEGAL_VERSION in src/main.tsx; accepting skips the first-run legal gate.
const LEGAL_KEY = 'deez-vrm-viewer:legal-acceptance';
const LEGAL_VERSION = '2026-07-05-v2';

/** Console errors and uncaught page errors seen during a test. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  return errors;
}

const modelInput = (page: Page) => page.locator('header input[type="file"][accept^=".vrm,"]');

/** The viewer chunk loads after first paint; a model opened before it is ready is ignored. */
const viewerReady = (page: Page) => expect(page.locator('.viewport')).toHaveAttribute('data-viewer-ready', 'true');

async function openFixture(page: Page) {
  await viewerReady(page);
  await modelInput(page).setInputFiles({ name: 'minimal.vrm', mimeType: 'model/gltf-binary', buffer: readFileSync(FIXTURE) });
  await expect(page.locator('.status-summary')).toHaveText('Ready');
}

/** Share of canvas pixels that differ clearly from the top-left (background) pixel; the renderer keeps its drawing buffer. */
const canvasCoverage = (page: Page) => page.locator('.viewport canvas').evaluate((canvas: HTMLCanvasElement) => {
  const copy = document.createElement('canvas');
  copy.width = canvas.width; copy.height = canvas.height;
  const context = copy.getContext('2d')!;
  context.drawImage(canvas, 0, 0);
  const { data } = context.getImageData(0, 0, copy.width, copy.height);
  const [r, g, b] = [data[0], data[1], data[2]];
  let differing = 0;
  for (let n = 0; n < data.length; n += 4) if (Math.abs(data[n] - r) + Math.abs(data[n + 1] - g) + Math.abs(data[n + 2] - b) > 48) differing++;
  return differing / (data.length / 4);
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(([key, version]) => localStorage.setItem(key, version), [LEGAL_KEY, LEGAL_VERSION]);
});

test('app shell renders without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await expect(page.locator('.brand b')).toHaveText('Deez VRM Viewer');
  await expect(page.locator('.empty-state h1')).toHaveText('Drop a .VRM file here');
  await expect(page.locator('.status-summary')).toHaveText('Waiting for model');
  await expect(page.locator('.legal-dialog')).toHaveCount(0);
  await expect(page.locator('.viewport canvas')).toBeVisible();
  await viewerReady(page);
  // The viewer chunk loads lazily; Screenshot opens the (also lazy) capture dialog once it has.
  await page.getByRole('button', { name: 'Screenshot' }).click();
  await expect(page.locator('.capture-dialog')).toBeVisible();
  expect(errors).toEqual([]);
});

test('opens the fixture VRM and shows its metadata', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await openFixture(page);
  await expect(page.locator('.viewport-badge')).toHaveText('VRM 1');
  await expect(page.locator('.brand span')).toHaveText('minimal.vrm');
  await expect(page.locator('.selection-card b')).toHaveText('Deez fixture');
  await expect(page.locator('.tree-root')).toContainText('Deez fixture');
  const metadata = page.locator('.accordion', { has: page.locator('.accordion-title', { hasText: 'VRM Metadata' }) });
  await expect(metadata).toContainText('VRM 1');
  await expect(metadata).toContainText('deac online · Worldbuild.io');
  await expect(metadata).toContainText('https://vrm.dev/licenses/1.0/');
  await expect(page.locator('.licence-details')).toHaveAttribute('data-licence-version', '1');
  await expect(page.locator('details[data-group="Expressions"]')).toHaveAttribute('data-total', '1');
  await expect(page.locator('.viewport')).toHaveAttribute('data-spring-joints', '2');
  expect(errors).toEqual([]);
});

test('renders the model to the canvas', async ({ page }) => {
  await page.goto('./');
  await openFixture(page);
  await expect.poll(() => canvasCoverage(page)).toBeGreaterThan(0.02);
});

test('camera presets reframe the model', async ({ page }) => {
  await page.goto('./');
  await openFixture(page);
  await page.getByRole('button', { name: 'Scene appearance' }).click();
  const before = await canvasCoverage(page);
  for (const preset of ['portrait', 'thumbnail', 'full'] as const) {
    const button = page.locator(`button[data-camera-preset="${preset}"]`);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.viewport')).toHaveAttribute('data-camera-preset', preset);
  }
  await page.locator('button[data-camera-preset="portrait"]').click();
  // A head-and-shoulders crop fills far more of the frame than the default whole-body framing.
  await expect.poll(() => canvasCoverage(page)).toBeGreaterThan(before * 1.5);
});

test('PNG capture downloads an image of the chosen size', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await openFixture(page);
  await page.getByRole('button', { name: 'Screenshot' }).click();
  const dialog = page.locator('.capture-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('select[data-capture-size]').selectOption('vrchat');
  await expect(dialog).toHaveAttribute('data-output-size', '1200x900');
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.locator('button[data-capture-save]').click()]);
  expect(download.suggestedFilename()).toMatch(/-1200x900\.png$/);
  const png = readFileSync(await download.path());
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 900]);
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a non-model file renamed to .vrm shows the error card', async ({ page }) => {
  await page.goto('./');
  await viewerReady(page);
  await modelInput(page).setInputFiles({ name: 'not-a-model.vrm', mimeType: 'model/gltf-binary', buffer: Buffer.from('This is a plain text file, not a VRM.\n') });
  const card = page.locator('.error-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('This model could not be opened.');
  await expect(card).toContainText('valid binary glTF/VRM header');
  await expect(page.locator('.status-summary')).toHaveText('error');
});

// Captures of the interface in replay mode, for the contest figures (F2, F3, F4, F8, F9, F10).
// Needs: `npm --prefix interface run dev -- --mode replay --port 5199` and a Chromium-based browser started with
//   <browser> --headless=new --remote-debugging-port=9333 --user-data-dir=<empty folder> about:blank
// and `playwright-core` installed outside the repository (npm i playwright-core). Writes entrega/raw_*.png; then run tools/make_figures.py.
import { chromium } from 'playwright-core';
export const OUT = new URL('../../entrega/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

export async function open(w = 1920, h = 1080, dpr = 1.5) {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });   // panels start in their default state
  await page.goto('http://localhost:5199/');
  await page.waitForTimeout(1500);
  return { browser, page };
}

/** IEEE 118 with the compact left menu, the directory closed and the labels (MW under each bus) off; the bus numbers stay. */
export async function setup(page, { menu = 'mini', directory = false } = {}) {
  await page.click('text=Start IEEE 118');
  await page.waitForTimeout(3000);
  if (menu !== 'full') {
    await page.click('button[title="Left Menu"]');                       // full -> mini
    if (menu === 'hidden') await page.click('button[title="Left Menu"]');   // mini -> hidden
    await page.waitForTimeout(400);
  }
  if (!directory) await page.click('[title="Hide Panel"]').catch(() => {});   // Element Directory (right menu)
  await page.waitForTimeout(500);
  const labels = page.locator('button[aria-pressed]', { hasText: 'Aa' });
  if (await labels.count() && (await labels.first().getAttribute('aria-pressed')) === 'true') await labels.first().click();   // labels (MW under each bus) off
  await page.waitForTimeout(300);
}

export async function runScreening(page) {
  await page.click('text=N-1 screening (risk map)');
  await page.waitForTimeout(500);
  await page.click('text=Run the screening').catch(() => {});
  await page.waitForTimeout(2000);
}

/** Drags a floating panel by its title bar to (x, y) (top-left corner). */
export async function moveTo(page, testId, x, y) {
  const b = await page.locator(`[data-testid="${testId}"]`).boundingBox();
  const sx = b.x + 40, sy = b.y + 14;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + (x - b.x) / 2, sy + (y - b.y) / 2, { steps: 6 });
  await page.mouse.move(sx + (x - b.x), sy + (y - b.y), { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

export async function hidePanels(page, on = true) {
  await page.evaluate((on) => {
    let s = document.getElementById('hide-panels');
    if (!s) { s = document.createElement('style'); s.id = 'hide-panels'; document.head.appendChild(s); }
    s.textContent = on ? '[data-panel-id]{visibility:hidden !important}' : '';
  }, on);
  await page.waitForTimeout(200);
}

export async function applyLine85(page) {
  await runScreening(page);
  await page.click('tr:has-text("line 8–5")');
  await page.waitForTimeout(2500);
}

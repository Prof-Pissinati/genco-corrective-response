import { open, OUT, setup, applyLine85, hidePanels } from './comum.mjs';
import { writeFileSync } from 'node:fs';
const { browser, page } = await open(2400, 1500, 1);   // large window: the diagram grows with it, so bus numbers and tooltips are relatively sharper
await setup(page);
await applyLine85(page);
// clip = bounding box of the diagram (bus labels) plus a margin
const clip = await page.evaluate(() => {
  let x0 = 1e9, y0 = 1e9, x1 = 0, y1 = 0;
  for (const t of document.querySelectorAll('svg text')) {
    if (!/^\d+$/.test(t.textContent.trim())) continue;
    const r = t.getBoundingClientRect();
    if (r.width === 0) continue;
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
  }
  const m = 45;
  return { x: Math.max(0, Math.round(x0 - m)), y: Math.max(0, Math.round(y0 - m)), width: Math.round(x1 - x0 + 2 * m), height: Math.round(y1 - y0 + 2 * m) };
});
// where the faulted line (8-5) is, to point at it in the figure and to hover it for the tooltip
const centers = async () => page.evaluate(() => {
  const out = {};
  for (const t of document.querySelectorAll('svg text')) {
    const s = t.textContent.trim();
    if (s === '5' || s === '8') { const r = t.getBoundingClientRect(); out[s] = [r.x + r.width / 2, r.y + r.height / 2]; }
  }
  return out;
});
let mid = null;
const stages = [['a_pre', 'Pre-fault'], ['b_post', 'Post-fault'], ['c_plan', 'With plan']];
// 1) clean "with plan" diagram (no tooltip), used next to the corrective panel in F3
await page.click('[data-testid="corrective-panel"] >> text="With plan"');
await page.waitForTimeout(1200);
await hidePanels(page, true);
await page.screenshot({ path: OUT + 'raw_F3_diagram.png', clip });
await hidePanels(page, false);
// 2) the three states with the tooltip of line 8-5 pinned (Shift+click) and dragged to an empty corner, so it does not cover any bus
for (const [name, label] of stages) {
  await page.click(`[data-testid="corrective-panel"] >> text="${label}"`);
  await page.waitForTimeout(1200);
  await hidePanels(page, true);
  if (!mid) {
    const c = await centers();
    mid = [(c['5'][0] + c['8'][0]) / 2, (c['5'][1] + c['8'][1]) / 2];
    writeFileSync(OUT + 'raw_F2_coords.json', JSON.stringify({ clip, mid: [mid[0] - clip.x, mid[1] - clip.y], bus5: [c['5'][0] - clip.x, c['5'][1] - clip.y], bus8: [c['8'][0] - clip.x, c['8'][1] - clip.y] }));
    await page.mouse.move(mid[0], mid[1], { steps: 4 });
    await page.waitForTimeout(300);
    await page.keyboard.down('Shift'); await page.mouse.click(mid[0], mid[1]); await page.keyboard.up('Shift');
    await page.waitForTimeout(500);
    const card = await page.locator('.pinned-card').first().boundingBox();
    const tx = clip.x + clip.width - card.width - 70, ty = clip.y + 90;      // top-right corner of the diagram is empty
    await page.mouse.move(card.x + 30, card.y + 12);
    await page.mouse.down();
    await page.mouse.move(tx + 30, ty + 12, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);
  }
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + `raw_F2_${name}.png`, clip });
  await hidePanels(page, false);
}
await page.close(); await browser.close();

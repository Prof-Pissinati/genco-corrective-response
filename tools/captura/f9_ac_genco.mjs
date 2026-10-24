import { open, OUT, setup, applyLine85, runScreening, hidePanels } from './comum.mjs';
import { writeFileSync } from 'node:fs';
// Two states compared AC vs GENCO (precomputed, line outage, base dispatch, no redispatch):
//   typical  line 76-77 out, no overload (a typical GENCO error, 60th percentile of the 177 outages, flows change a lot)
//   overload line 8-5 out, 7 lines above their limit in both AC and GENCO
for (const sc of ['typical', 'overload']) {
  const { browser, page } = await open(1920, 1080, 1);
  await setup(page);
  if (sc === 'overload') {
    await applyLine85(page);
    await page.click('[data-testid="corrective-panel"] >> text="Post-fault"');
  } else {
    await runScreening(page);
    await page.uncheck('text=only those that need a plan');
    await page.uncheck('text=only with plan');
    await page.waitForTimeout(500);
    await page.click('[data-testid="screening-panel"] tr:has-text("line 76–77")');
    await page.waitForTimeout(7000);                       // the demo says a plan is not precomputed for it; the line is open anyway
  }
  await page.waitForTimeout(800);
  await hidePanels(page, true);
  const clip = await page.evaluate(() => {
    let x0 = 1e9, x1 = 0, y1 = 0;
    for (const t of document.querySelectorAll('svg text')) {
      if (!/^\d+$/.test(t.textContent.trim())) continue;
      const r = t.getBoundingClientRect();
      if (r.width === 0) continue;
      x0 = Math.min(x0, r.x); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    }
    return { x: Math.round(x0 - 45), y: 0, width: Math.round(x1 - x0 + 90), height: Math.round(y1 + 45) };
  });
  for (const m of ['ac', 'genco']) {
    await page.click(`[data-testid="solver-selector-${m}"]`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: OUT + `raw_F9_${sc}_${m}.png`, clip });
  }
  const chip = await page.$eval('[data-testid="genco-view-chip"]', e => e.innerText);
  writeFileSync(OUT + `raw_F9_${sc}_chip.txt`, chip, 'utf8');
  console.log(sc, chip);
  await page.close(); await browser.close();
}

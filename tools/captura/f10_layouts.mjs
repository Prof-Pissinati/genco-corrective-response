import { open, OUT, setup, applyLine85, moveTo, hidePanels } from './comum.mjs';
// four layouts of the same state: left menu full / compact / hidden (directory closed) and the directory (right menu) open
for (const [name, menu, directory] of [['full', 'full', false], ['mini', 'mini', false], ['hidden', 'hidden', false], ['directory', 'mini', true]]) {
  const { browser, page } = await open(1920, 1080);
  await setup(page, { menu, directory });
  await applyLine85(page);
  await page.click('[data-testid="corrective-panel"] >> text="With plan"');
  await page.click('[data-testid="screening-panel"] >> xpath=.//button[@title="Close" or contains(.,"✖")]').catch(() => {});
  if (directory) await hidePanels(page, true);
  else await moveTo(page, 'corrective-panel', 1540, 50);
  await page.screenshot({ path: OUT + `raw_F10_${name}.png` });
  await page.close(); await browser.close();
}

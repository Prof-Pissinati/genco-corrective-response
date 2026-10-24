import { open, OUT, setup, applyLine85, moveTo, hidePanels } from './comum.mjs';
const { browser, page } = await open();
await setup(page);
await applyLine85(page);
await page.click('[data-testid="corrective-panel"] >> text="With plan"');
await page.click('button[title="Repair and block reconnection"]');
await page.waitForTimeout(800);
await page.click('text=/Simulate/');
await page.waitForTimeout(800);
await page.click('[data-testid="recovery-panel"] button:has-text("Pause")').catch(() => {});
await page.click('[data-testid="recovery-panel"] button[title="Start"]');
for (let i = 0; i < 3; i++) { await page.click('[data-testid="recovery-panel"] button[title="Next step"]'); await page.waitForTimeout(200); }
await page.click('[data-testid="screening-panel"] >> xpath=.//button[@title="Close" or contains(.,"✖")]').catch(() => {});
await moveTo(page, 'recovery-panel', 1380, 60);
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + 'raw_F8_recovery.png' });
await page.close(); await browser.close();

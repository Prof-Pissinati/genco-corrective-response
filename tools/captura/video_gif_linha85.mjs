// Records the short GIF for the post: N-1 screening -> pick line 8-5 -> pre-fault, post-fault and with-plan states.
// Same method as video_cenas_1_2.mjs (screencast with time stamps, cursor drawn afterwards by tools/montar_gif_linha85.py).
// Run against the local build (npm --prefix interface run dev -- --mode replay --port 5199) so the colors match the figures of the post.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { OUT, setup, runScreening, moveTo as dragPanel } from './comum.mjs';

const DIR = OUT + 'video/gif_linha85/';
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
const now = () => Date.now() / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
await page.goto(process.env.DEMO_URL || 'http://localhost:5199/', { waitUntil: 'load' });
await sleep(1500);
// not recorded: compact menu, directory closed, N-1 sweep done; panels docked on the right (free area), corrective panel collapsed
await setup(page);
await runScreening(page);
await page.locator('[data-testid="corrective-panel"] > div').first().dblclick({ position: { x: 120, y: 12 } });   // collapse it
await sleep(300);
await dragPanel(page, 'corrective-panel', 1500, 30);
await dragPanel(page, 'screening-panel', 1430, 90);
await sleep(400);

const frames = [];
cdp.on('Page.screencastFrame', async (f) => {
  frames.push({ ts: f.metadata.timestamp, data: f.data });
  try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) { /* over */ }
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
while (!frames.length) await sleep(20);
await sleep(300);
const T0 = now();
const cursor = [], clicks = [];
let cx = 1700, cy = 800;
const t = () => now() - T0;
const record = () => cursor.push([t(), cx, cy]);
async function waitUntil(sec) { const d = (T0 + sec - now()) * 1000; if (d > 0) await sleep(d); }
const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
async function moveTo(x, y, sec) {
  const x0 = cx, y0 = cy, start = now();
  while (true) {
    const u = Math.min(1, (now() - start) / sec);
    cx = x0 + (x - x0) * ease(u); cy = y0 + (y - y0) * ease(u);
    await page.mouse.move(cx, cy); record();
    if (u >= 1) break;
    await sleep(8);
  }
}
async function click() { clicks.push([t(), cx, cy]); await page.mouse.down(); await sleep(60); await page.mouse.up(); record(); }
async function center(sel) { const b = await page.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; }
async function clickOn(sel, sec = 0.5) { const [x, y] = await center(sel); await moveTo(x, y, sec); await sleep(100); await click(); }

record();
await waitUntil(0.8);
const [rx, ry] = await center('[data-testid="screening-panel"] tr:has-text("line 8–5")');
await moveTo(rx, ry, 1.0);
await waitUntil(2.0); await click();                                              // pick line 8-5
await waitUntil(3.0); await clickOn('[data-testid="screening-panel"] button[title^="Collapse"]', 0.5);
await waitUntil(3.9); await clickOn('[data-testid="corrective-panel"] button[title="Expand"]', 0.5);
await waitUntil(5.4); await clickOn('[data-testid="corrective-panel"] >> text="Pre-fault"', 0.5);
await waitUntil(7.0); await clickOn('[data-testid="corrective-panel"] >> text="Post-fault"', 0.4);
await waitUntil(8.6); await clickOn('[data-testid="corrective-panel"] >> text="With plan"', 0.4);
await waitUntil(11.0); await moveTo(1750, 900, 0.9);
await waitUntil(13.6);
await cdp.send('Page.stopScreencast');
writeFileSync(DIR + 'manifest.json', JSON.stringify({ T0, frames: frames.map((f, i) => ({ ts: f.ts, file: `f${String(i).padStart(5, '0')}.jpg` })), cursor, clicks }));
frames.forEach((f, i) => writeFileSync(DIR + `f${String(i).padStart(5, '0')}.jpg`, Buffer.from(f.data, 'base64')));
console.log('frames', frames.length, 'span', (frames[frames.length - 1].ts - frames[0].ts).toFixed(1), 's');
await page.close();
await browser.close();

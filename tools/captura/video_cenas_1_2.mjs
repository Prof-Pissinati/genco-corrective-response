// Re-records scenes 1 and 2 of the contest video (0-25 s): start screen, opening the IEEE 118, and the left menu / element directory
// opening and closing. The screen is captured with the browser's screencast (60 fps during animations) and saved with the time of
// each frame; tools/montar_cenas_1_2.py then resamples it to 30 fps, draws the cursor and the caption, and writes the clip.
//
// Needs a Chromium-based browser started with --remote-debugging-port=9333 (see comum.mjs) and playwright-core installed outside the repository.
// The cue times follow the words of the narration of scene 2 ("... full, compact or hidden, and the element directory ... opens and closes on demand").
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { OUT } from './comum.mjs';

const URL = process.env.DEMO_URL || 'https://prof-pissinati.github.io/genco-corrective-response/';   // the demo the rest of the video was recorded on
const DIR = OUT + 'video/cenas_1_2/';
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const now = () => Date.now() / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
// the corrective panel starts collapsed, as in the rest of the video
await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('genco.panel.corrective', JSON.stringify({ pos: { left: 340, top: 58 }, collapsed: true })); } catch (e) {} });
await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
await sleep(1500);

const frames = [];
cdp.on('Page.screencastFrame', async (f) => {
  frames.push({ ts: f.metadata.timestamp, data: f.data });
  try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) { /* the session is over */ }
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
while (!frames.length) await sleep(20);
await sleep(300);

const T0 = now();
const cursor = [];   // [seconds from T0, x, y]
const clicks = [];   // [seconds from T0, x, y]
let cx = 1500, cy = 760;
const t = () => now() - T0;
const record = () => cursor.push([t(), cx, cy]);
async function waitUntil(sec) { const d = (T0 + sec - now()) * 1000; if (d > 0) await sleep(d); }
const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
async function moveTo(x, y, sec) {
  const x0 = cx, y0 = cy, start = now();
  while (true) {
    const u = Math.min(1, (now() - start) / sec);
    cx = x0 + (x - x0) * ease(u); cy = y0 + (y - y0) * ease(u);
    await page.mouse.move(cx, cy);
    record();
    if (u >= 1) break;
    await sleep(8);
  }
}
async function click() { clicks.push([t(), cx, cy]); await page.mouse.down(); await sleep(60); await page.mouse.up(); record(); }
async function center(sel) { const b = await page.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; }
async function clickOn(sel, sec = 0.5) { const [x, y] = await center(sel); await moveTo(x, y, sec); await sleep(120); await click(); }
const MENU = 'button[title="Left Menu"]';
const ARROW = '[title="Hide Panel"], [title="Element Directory"]';

record();
// scene 1: start screen, the cursor goes to "Start IEEE 118" and clicks it
await waitUntil(1.2);
const [bx, by] = await center('text=Start IEEE 118');
await moveTo(bx - 40, by + 4, 2.0);
await waitUntil(4.2);
await moveTo(bx + 20, by, 0.5);
await waitUntil(4.9);
await click();                                           // the app opens (full menu, element directory open, corrective panel collapsed)
await waitUntil(5.6);
await moveTo(1200, 560, 2.2);                            // the cursor leaves the button and rests over the diagram
// scene 2 (narration starts at 10.41): the cues follow the words "compact", "hidden", "directory", "opens", "closes"
await waitUntil(12.6);
const [mx, my] = await center(MENU);
await moveTo(mx, my, 0.9);
await waitUntil(13.65); await click();                   // full -> compact
await waitUntil(13.95); await clickOn(MENU, 0.3);        // compact -> hidden (the click lands at ~14.4 s, on the word "hidden")
await waitUntil(15.0); const [ax, ay] = await center(ARROW); await moveTo(ax, ay, 0.45);
await waitUntil(15.55); await click();                   // directory closes
await waitUntil(16.6); await click();                    // directory opens
await waitUntil(17.15); await click();                   // directory closes
await waitUntil(18.9); await clickOn(MENU, 0.8);         // hidden -> full
await waitUntil(20.6); await clickOn(MENU, 0.5);         // full -> compact (the state scene 3 starts from)
await waitUntil(21.5); await clickOn('[title="Center the Chart"]', 0.7);   // the diagram fits the new layout, as it does when scene 3 starts
await waitUntil(22.9); await clickOn('[data-testid="corrective-panel"] button[title="Expand"]', 0.8);   // the corrective panel opens, as scene 3 begins
await waitUntil(24.2); await moveTo(1800, 170, 0.8);   // rests on an empty corner (no tooltip)
await waitUntil(25.2);
await cdp.send('Page.stopScreencast');

writeFileSync(DIR + 'manifest.json', JSON.stringify({ T0, frames: frames.map((f, i) => ({ ts: f.ts, file: `f${String(i).padStart(5, '0')}.jpg` })), cursor, clicks }));
frames.forEach((f, i) => writeFileSync(DIR + `f${String(i).padStart(5, '0')}.jpg`, Buffer.from(f.data, 'base64')));
console.log('frames', frames.length, 'span', (frames[frames.length - 1].ts - frames[0].ts).toFixed(1), 's');
await page.close();
await browser.close();

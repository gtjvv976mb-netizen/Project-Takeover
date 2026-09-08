// Headless screenshots of every scroll station on the home page (uses the installed Google Chrome).
import { chromium } from "playwright-core";
const out = process.argv[2] ?? "data/shots";
const base = process.argv[3] ?? "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(6000);
for (let i = 0; i <= 4; i++) {
  await page.evaluate((k) => window.scrollTo({ top: window.innerHeight * k, behavior: "instant" }), i);
  await page.mouse.move(700 + i * 40, 400);
  await page.waitForTimeout(2800);
  await page.screenshot({ path: `${out}/station-${i}.png` });
}
await page.goto(`${base}/sell`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/sell.png` });
await browser.close();
console.log("errors:", errors.filter((e) => !e.includes("_next/hmr")).slice(0, 10));

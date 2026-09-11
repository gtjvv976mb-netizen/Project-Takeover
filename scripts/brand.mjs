// Renders the pump.fun coin assets from the "Lights On" mark, so the art the coin ships
// with is the same geometry the site draws — regenerate, never redraw by hand.
//
//   node scripts/brand.mjs [outDir]     default: public/brand
//
// Sizes follow pump.fun's uploads: a square coin image (1000×1000 is comfortably above
// its minimum and stays sharp when the feed crops it to a circle) and a 1500×500 banner.
// The 1200×630 card is the other shape that matters — it is what X, Discord and Telegram
// show when somebody pastes the link, which for this project is the whole distribution.
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const out = process.argv[2] ?? "public/brand";
await mkdir(out, { recursive: true });

const VIOLET = "#7C5CFF";
const TEAL = "#10BFAE";

/** The mark, verbatim from src/components/Logo.tsx. */
const GHOST = "M6 16.4a10 10 0 0 1 20 0V27l-3.33-3.1L19.33 27 16 23.9 12.67 27 9.33 23.9 6 27Z";

/**
 * The ghost on its own, padded into a square. `fill` is how far the shell has refilled.
 * It stops below y 17.5 on purpose: the eyes sit at cy 14.6 r 2.35, and a fill line run
 * any higher swallows them, turning "lights on in an empty shell" into a solid blob.
 */
function mark({ size, fill = 0.44, glow = false }) {
  const top = 27 - (27 - 6.4) * fill;
  // Ghost spans x 6→26, y 6.4→27 in a 32 grid. Pad to 36 and centre it.
  return `<svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="6" y1="6" x2="30" y2="30" gradientUnits="userSpaceOnUse">
      <stop stop-color="${VIOLET}"/><stop offset="1" stop-color="${TEAL}"/>
    </linearGradient>
    <clipPath id="cp"><rect x="0" y="${top}" width="32" height="${32 - top}"/></clipPath>
    ${glow ? `<filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="0.55" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>` : ""}
  </defs>
  <g transform="translate(2 1.3)" ${glow ? 'filter="url(#glow)"' : ""}>
    <path d="${GHOST}" stroke="url(#g)" stroke-width="2.6" stroke-linejoin="round"/>
    <g clip-path="url(#cp)"><path d="${GHOST}" fill="url(#g)"/></g>
    <circle cx="12.4" cy="14.6" r="2.35" fill="url(#g)"/>
    <circle cx="19.6" cy="14.6" r="2.35" fill="url(#g)"/>
  </g>
</svg>`;
}

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">`;

const RESET = `*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;overflow:hidden}
body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased}`;

/** Dark: lights on, in the dark. Sits native on pump.fun's own dark feed. */
const darkGround = `background:#0F0D24;background-image:
  radial-gradient(52% 52% at 24% 20%, rgba(124,92,255,.38), transparent 72%),
  radial-gradient(50% 50% at 80% 84%, rgba(16,191,174,.30), transparent 72%);`;

/** Light: the site's own ground, for anywhere the dark tile would disappear. */
const lightGround = `background:#FAF9FE;background-image:
  radial-gradient(60% 60% at 28% 26%, rgba(124,92,255,.22), transparent 70%),
  radial-gradient(55% 55% at 76% 78%, rgba(16,191,174,.20), transparent 70%),
  radial-gradient(60% 60% at 62% 20%, rgba(255,138,61,.12), transparent 70%);`;

const coin = (dark) => `<!doctype html><html><head>${FONTS}<style>${RESET}
body{${dark ? darkGround : lightGround}display:grid;place-items:center}
</style></head><body>${mark({ size: 760, glow: dark })}</body></html>`;

/** The link-preview card. Taller than the banner, so the mark can sit above the words. */
const card = (dark) => `<!doctype html><html><head>${FONTS}<style>${RESET}
body{${dark ? darkGround : lightGround}display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:6px;text-align:center;padding:0 80px;color:${dark ? "#FFFFFF" : "#1B1830"}}
.name{font-size:92px;font-weight:800;letter-spacing:-.035em;line-height:1.02}
.name b{background:linear-gradient(105deg,${VIOLET},${TEAL});-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:800}
.tag{margin-top:22px;font-size:34px;font-weight:600;letter-spacing:-.01em;opacity:${dark ? ".82" : ".76"}}
.foot{margin-top:30px;display:flex;align-items:center;gap:14px;font-family:'JetBrains Mono',monospace;
  font-size:21px;letter-spacing:.02em;opacity:${dark ? ".62" : ".58"}}
.dot{width:10px;height:10px;border-radius:99px;background:${TEAL};box-shadow:0 0 0 6px ${TEAL}22}
</style></head><body>
  ${mark({ size: 190, glow: dark })}
  <div class="name">Think you&rsquo;d run it better?<br><b>Buy it.</b></div>
  <div class="tag">Buy Solana projects outright, not by the bag.</div>
  <div class="foot"><span class="dot"></span>project-takeover.com</div>
</body></html>`;

const banner = (dark) => `<!doctype html><html><head>${FONTS}<style>${RESET}
body{${dark ? darkGround : lightGround}display:flex;align-items:center;gap:46px;padding:0 96px;
  color:${dark ? "#FFFFFF" : "#1B1830"}}
.name{font-size:76px;font-weight:800;letter-spacing:-.03em;line-height:1}
.name b{background:linear-gradient(105deg,${VIOLET},${TEAL});-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:800}
.tag{margin-top:16px;font-size:31px;font-weight:600;letter-spacing:-.01em;opacity:${dark ? ".82" : ".76"}}
.tag b{background:linear-gradient(105deg,${VIOLET},${TEAL});-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:800;opacity:1}
.foot{margin-top:26px;display:flex;align-items:center;gap:14px;font-family:'JetBrains Mono',monospace;
  font-size:19px;letter-spacing:.02em;opacity:${dark ? ".62" : ".58"}}
.dot{width:9px;height:9px;border-radius:99px;background:${TEAL};box-shadow:0 0 0 5px ${TEAL}22}
</style></head><body>
  ${mark({ size: 296, glow: dark })}
  <div>
    <div class="name">Project: <b>Takeover</b></div>
    <div class="tag">Think you&rsquo;d run it better? <b>Buy it.</b></div>
    <div class="foot"><span class="dot"></span>Solana's first trustless handover &nbsp;·&nbsp; project-takeover.com</div>
  </div>
</body></html>`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const jobs = [
  ["token-dark.png", coin(true), 1000, 1000],
  ["token-light.png", coin(false), 1000, 1000],
  ["banner-dark.png", banner(true), 1500, 500],
  ["banner-light.png", banner(false), 1500, 500],
  ["og.png", card(true), 1200, 630],
];

for (const [name, html, width, height] of jobs) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${out}/${name}` });
  await page.close();
  console.log(`${out}/${name}  ${width}×${height}`);
}
await browser.close();

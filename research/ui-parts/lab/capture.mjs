import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outDir = path.resolve(__dirname, "../screenshots");
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const htmlPath = path.resolve(__dirname, "index.html");
const fileUrl = `file://${htmlPath.replace(/\\/g, "/")}`;

const tasks = [
  { file: "clip-grid-agent.png", query: "?part=clip-grid&demo=agent" },
  { file: "clip-grid-preset.png", query: "?part=clip-grid&demo=preset" },
  { file: "clip-grid-presentation.png", query: "?part=clip-grid&demo=presentation" },
  { file: "safe-triangle-normal.png", query: "?part=safe-triangle&demo=normal" },
  { file: "safe-triangle-debug.png", query: "?part=safe-triangle&demo=debug" },
  { file: "statusline-agent.png", query: "?part=statusline&demo=agent" },
  { file: "statusline-build.png", query: "?part=statusline&demo=build" },
  { file: "statusline-compact.png", query: "?part=statusline&demo=compact" },
];

async function run() {
  console.log("Launching headless browser to capture UI Parts screenshots...");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1040, height: 680 } });

  for (const task of tasks) {
    const targetUrl = `${fileUrl}${task.query}`;
    await page.goto(targetUrl, { waitUntil: "load" });
    await page.waitForTimeout(300);

    const dest = path.join(outDir, task.file);
    await page.screenshot({ path: dest, fullPage: false });
    console.log(`Saved screenshot: ${task.file}`);
  }

  await browser.close();
  console.log("All 8 screenshots captured successfully!");
}

run().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});

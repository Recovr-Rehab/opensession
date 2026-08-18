/**
 * Re-shoot the landing page's product poster.
 *
 * The preview iframe carries the whole app bundle, so it is a second or two
 * before there is anything to look at. The poster is that first frame, painted
 * from a file instead: the page shows the product immediately and swaps in the
 * live app underneath it when it is ready.
 *
 * It is a picture of the real preview, taken at the width the preview lays the
 * app out at (`desktopDemoWidth` in website/ProductDemo.tsx) and the aspect the
 * desktop window has, so the swap lands on the same pixels. Re-run it whenever
 * the demo's fixtures or the app's chrome change:
 *
 *   bun scripts/build-website.ts && bun scripts/capture-demo-poster.ts
 *
 * One shot per theme, because the preview follows the visitor's system theme.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireCdpBrowser,
  closeCdpTarget,
  releaseCdpBrowser,
} from "./lib/cdp-browser";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, ".website-dist");

/** The app's layout width in the preview. Keep in step with ProductDemo.tsx. */
const APP_WIDTH = 1080;
/**
 * The desktop window's aspect: a 3:2 stage less an even 5.6% inset on all four
 * sides, which is 0.888W by 0.5547W. Narrower windows crop the poster from the
 * top rather than stretching it.
 */
const APP_HEIGHT = Math.round((APP_WIDTH * 0.5547) / 0.888);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connect(port: number, targetId: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${targetId}`);
  await new Promise((resolve) => (ws.onopen = () => resolve(null)));
  let id = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data));
    const p = msg.id && pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
  };
  const send = (method: string, params: unknown = {}) =>
    new Promise<any>((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { send, close: () => ws.close() };
}

if (!(await Bun.file(join(DIST, "product-demo.html")).exists()))
  throw new Error("no .website-dist — run `bun scripts/build-website.ts` first");

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const file = Bun.file(DIST + (path === "/" ? "/index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("", { status: 404 });
  },
});
const base = `http://127.0.0.1:${server.port}`;
const scratch = mkdtempSync(join(tmpdir(), "demo-poster-"));

const lease = await acquireCdpBrowser();
try {
  for (const theme of ["light", "dark"] as const) {
    const created = await fetch(
      `http://127.0.0.1:${lease.port}/json/new?about:blank`,
      { method: "PUT" },
    ).then((r) => r.json());
    const t = await connect(lease.port, created.id);
    try {
      await t.send("Page.enable");
      await t.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: theme }],
      });
      await t.send("Emulation.setDeviceMetricsOverride", {
        width: APP_WIDTH,
        height: APP_HEIGHT,
        deviceScaleFactor: 2,
        mobile: false,
      });
      await t.send("Page.navigate", { url: `${base}/product-demo.html` });

      // The composer is the last thing the demo paints, so it standing in the
      // window is the signal that there is a product to photograph.
      const deadline = Date.now() + 40_000;
      for (;;) {
        const { result } = await t.send("Runtime.evaluate", {
          expression: `!!document.querySelector('.composer-textarea, [class*="composer"] textarea')`,
          returnByValue: true,
        });
        if (result.value) break;
        if (Date.now() > deadline) throw new Error("the demo never finished painting");
        await sleep(250);
      }
      await sleep(1500);
      await t.send("Page.bringToFront");
      const shot = await t.send("Page.captureScreenshot", { format: "png" });
      const png = join(scratch, `${theme}.png`);
      writeFileSync(png, Buffer.from(shot.data, "base64"));
      const out = join(ROOT, "website", theme === "dark" ? "demo-poster-dark.webp" : "demo-poster.webp");
      const convert = Bun.spawnSync([
        "python3",
        "-c",
        `from PIL import Image; Image.open(${JSON.stringify(png)}).convert("RGB").save(${JSON.stringify(out)}, "WEBP", quality=82, method=6)`,
      ]);
      if (convert.exitCode !== 0) throw new Error(convert.stderr.toString());
      const size = Bun.file(out).size / 1024;
      console.log(`${theme}: ${out} (${size.toFixed(0)} KB, ${APP_WIDTH}x${APP_HEIGHT} at 2x)`);
    } finally {
      t.close();
      await closeCdpTarget(lease.port, created.id);
    }
  }
} finally {
  await releaseCdpBrowser(lease);
  server.stop(true);
  rmSync(scratch, { recursive: true, force: true });
}

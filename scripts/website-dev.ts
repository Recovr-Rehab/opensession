import { join } from "node:path";
import { buildWebsiteTailwind } from "./website-tailwind";

const root = join(import.meta.dir, "..");
await buildWebsiteTailwind(root);
const [{ default: homepage }, { default: productDemo }] = await Promise.all([
	import("../website/index.html"),
	import("../website/product-demo.html"),
]);

const port = Number(process.env.PORT || 3865);

Bun.serve({
	port,
	hostname: "127.0.0.1",
	routes: {
		"/": homepage,
		"/product-demo.html": productDemo,
	},
	development: {
		hmr: true,
		console: true,
	},
});

console.log(`Open Session website: http://127.0.0.1:${port}`);

import { build } from "esbuild";
await build({
  entryPoints: ["services/morphic/server.mjs"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "services/morphic/dist/server.mjs",
  packages: "external",
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});

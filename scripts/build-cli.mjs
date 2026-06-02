import esbuild from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: [
    "@modelcontextprotocol/sdk/*",
    "next",
    "react",
    "react-dom",
    "lucide-react",
    "express",
    "cors",
    "yaml"
  ],
  logLevel: "info"
};

await Promise.all([
  esbuild.build({
    ...common,
    entryPoints: ["src/cli.ts"],
    outfile: "dist/cli.js",
    banner: {
      js: "#!/usr/bin/env node"
    }
  }),
  esbuild.build({
    ...common,
    entryPoints: ["apps/mcp-server/src/stdio.ts"],
    outfile: "dist/mcp-stdio.js"
  })
]);

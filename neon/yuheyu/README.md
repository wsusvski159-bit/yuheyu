# 屿和鱼 · Neon Functions

This directory contains the Web Standard entry used to run the 屿和鱼 MCP service on Neon Functions.

## Runtime

- Node.js 24
- Streamable HTTP MCP endpoint: `/mcp/<YUHEYU_MCP_SECRET>`
- Health check: `/health`
- Existing storage stays in Supabase; this deployment only moves the compute layer.

## Required environment variables

- `SUPABASE_SECRET_KEY`
- `SUPABASE_TABLE`
- `SUPABASE_URL`
- `YUHEYU_MCP_SECRET`
- `YUHEYU_SYNC_TOKEN`

Keep values outside Git.

## Build

```bash
npm install
npx esbuild server.js --bundle --platform=node --format=esm --outfile=dist/index.mjs
(cd dist && zip ../yuheyu-function.zip index.mjs)
```

Deploy `yuheyu-function.zip` to a Neon Function using the Node.js 24 runtime and the five environment variables above.

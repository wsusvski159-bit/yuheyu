# Private ChatGPT deployment

This deployment variant requires two independent server-side secrets in production:

- `COVE_MCP_ACCESS_KEY`: at least 32 random characters. It protects both MCP endpoints.
- `BRIDGE_INGEST_TOKEN`: a different random value. It protects `POST /events`.

Keep `NETEASE_COOKIE` in Render environment variables, never in Git or a chat.
The Bridge starts without a NetEase Cookie, but NetEase features require it.

For an MCP client that can send a Bearer token, connect to
`https://<host>/mcp/music` with `COVE_MCP_ACCESS_KEY` as the token. If the
client only accepts a URL, use
`https://<host>/private/<COVE_MCP_ACCESS_KEY>/mcp/music`. Treat that URL as a
password: do not share it or paste it into public logs or screenshots. Rotate
the key if it is exposed. The unprotected `/mcp` and `/mcp/music` paths return
404 when a key is configured.

Use Long-wait MCP for the initial test. Do not start the Widget Listener at
the same time. Long-wait requires a live ChatGPT turn and is not a permanent
background listener. Render Free can sleep after inactivity, so it is only
suitable for a connection test rather than reliable unattended listening.

import assert from "node:assert/strict";
import test from "node:test";

test("private MCP endpoints reject anonymous access and accept the configured secret", async () => {
  process.env.NODE_ENV = "test";
  const { createHttpServer } = await import("../src/server.js");
  const secret = "test-only-secret-0123456789abcdef";
  process.env.COVE_MCP_ACCESS_KEY = secret;

  const server = createHttpServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "auth-test", version: "1" },
      },
    });
    const call = (path: string, authorization?: string) => fetch(base + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(authorization ? { authorization } : {}),
      },
      body: payload,
    });

    assert.equal((await call("/mcp/music")).status, 404);
    assert.equal((await call("/private/wrong/mcp/music")).status, 404);
    assert.equal((await call("/mcp/music", "Bearer wrong")).status, 404);

    const viaBearer = await call("/mcp/music", `Bearer ${secret}`);
    assert.equal(viaBearer.status, 200);
    assert.equal((await viaBearer.json()).result.serverInfo.name, "cove-resonance-music");

    const viaPrivateUrl = await call(`/private/${secret}/mcp/music`);
    assert.equal(viaPrivateUrl.status, 200);
    assert.equal((await viaPrivateUrl.json()).result.serverInfo.name, "cove-resonance-music");
  } finally {
    delete process.env.COVE_MCP_ACCESS_KEY;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

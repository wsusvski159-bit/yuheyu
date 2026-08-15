# 屿和鱼 MCP - Supabase 补丁

把 `server.js` 和 `package.json` 上传到当前 GitHub 仓库根目录并覆盖旧文件。

Render 继续使用：
- Build Command: `npm install`
- Start Command: `node server.js`

新增环境变量：
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- 可选 `SUPABASE_TABLE=yuheyu_store`

原有 `YUHEYU_SYNC_TOKEN` 和 `YUHEYU_MCP_SECRET` 保留。

部署后访问 `/health`，应看到 `storage: "supabase"`。

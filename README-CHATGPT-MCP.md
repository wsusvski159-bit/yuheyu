# 《屿和鱼》ChatGPT / MCP 接入版

这是在原 v5.4 源码上恢复并增加 ChatGPT 桥接的一版。

## 这版新增

- 恢复 `阿屿的日记`，可读取 v5.5 备份中的 `jiangyuDiaries`。
- 备份格式升级为 `yuheyu.shared-memory.v2`，同时兼容旧 v1 备份导入。
- “备份与恢复”页新增 **同步给阿屿**。
- 同步是手动触发，不会自动上传。
- **秘密抽屉和照片永远不通过这个 MCP 桥上传。**
- 新增 `mcp-server/`，提供 ChatGPT 可调用的 MCP 工具。

## 第一次使用顺序

1. 先部署 `mcp-server/`（看 `mcp-server/README.md`）。
2. 把这个 PWA 重新部署到 Netlify。
3. 手机上打开新版《屿和鱼》，进入 **备份与恢复 → 同步给阿屿**。
4. 填 Render 服务地址和 `YUHEYU_SYNC_TOKEN`。
5. 点“测试连接”，再点“双向同步”。
6. 在 ChatGPT 里把 MCP 地址接入：`https://你的服务.onrender.com/mcp/<YUHEYU_MCP_SECRET>`。

## MCP 工具

- `yuheyu_status`：看同步状态和记录数量。
- `yuheyu_read`：读取/搜索信、日记、今天的小鱼、纪念、歌和留言。
- `yuheyu_add_memory`：写入纪念册。
- `yuheyu_add_diary`：写入阿屿的日记。
- `yuheyu_add_letter`：写入江屿的信。
- `yuheyu_set_ai_message`：更新留言页里的 AI 留言。

MCP 在远端写入后，手机点一次“双向同步”，新内容就会回到本机 App。

# 《屿和鱼》MCP 服务

这个目录是给 ChatGPT / MCP 用的私人桥接服务。

## 它会同步什么

会同步：
- 江屿的信
- 阿屿的日记
- 今天的小鱼（仅文字字段；照片不上传）
- 我们的纪念册（仅文字字段；照片不上传）
- 我们的歌
- 留言页

不会同步：
- 秘密抽屉
- 任何照片

PWA 不会自动上传。只有手机里点“**双向同步**”时才会发数据。

## Render 部署

1. 把 `mcp-server` 目录放进一个 GitHub 仓库（也可以整个项目一起放）。
2. Render → **New Web Service** → 选择仓库。
3. 如果仓库根目录是整个《屿和鱼》项目，把 **Root Directory** 设置成 `mcp-server`。
4. Build Command：`npm install`
5. Start Command：`npm start`
6. 设置两个环境变量：
   - `YUHEYU_SYNC_TOKEN`：自己生成一段很长的随机字符串。
   - `YUHEYU_MCP_SECRET`：另一段很长的随机字符串。
7. 部署后访问 `https://你的服务.onrender.com/health`，看到 `ok: true` 即可。

MCP 地址会是：

`https://你的服务.onrender.com/mcp/<YUHEYU_MCP_SECRET>`

手机 App 的“同步口令”填写 `YUHEYU_SYNC_TOKEN`，服务地址只填：

`https://你的服务.onrender.com`

## 免费 Render 的提醒

默认数据写在服务容器内的 `data/yuheyu.json`。如果托管平台重启/重建时不保留本地磁盘，远端副本可能消失；手机本机数据仍然是主备份，再点一次“双向同步”即可重新上传。

如果以后想让远端也长期可靠保存，可以把 `YUHEYU_DATA_FILE` 指向持久磁盘，或再换成数据库存储。

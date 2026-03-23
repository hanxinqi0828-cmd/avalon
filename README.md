# ⚔️ 阿瓦隆在线 (Avalon Online)

多人在线阿瓦隆桌游，5-10人游戏。

## 本地运行

```bash
npm install
npm start
```

浏览器打开 `http://localhost:3000`

## 部署到 Render（免费，推荐）

1. 将此文件夹推送到 GitHub 仓库
2. 打开 https://render.com → New → Web Service
3. 连接你的 GitHub 仓库
4. 设置：
   - Build Command: `npm install`
   - Start Command: `npm start`
5. 部署完成后会得到一个 URL，分享给所有玩家即可

## 部署到 Glitch（免费，最简单）

1. 打开 https://glitch.com
2. New Project → Import from GitHub（或直接上传文件）
3. 自动部署，得到 `xxx.glitch.me` 链接

## 部署到 Railway（免费额度）

1. 打开 https://railway.app
2. New Project → Deploy from GitHub
3. 自动检测 Node.js 项目并部署

## 游戏规则

- 5-10人游戏，分为正义阵营和邪恶阵营
- 每轮由队长选择队员执行任务
- 全员投票决定是否接受队伍
- 投票两次否决后轮换队长，且下次选择强制执行
- 三次任务成功正义方获胜，三次失败邪恶方获胜
- 正义方获胜后，刺客可尝试刺杀梅林翻盘

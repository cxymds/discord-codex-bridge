# Discord Codex Bridge

把 Discord 频道和本机 Codex CLI 会话连接起来的桥接服务。启动后，Bot 会在指定 Discord 频道注册 `/codex` 指令：

- `/codex new project:<本机项目路径> prompt:<初始任务>`：创建一个 Discord 线程，并在对应项目目录中启动 Codex。
- 在线程中继续发消息：续接同一个 Codex 会话。
- `/codex status`：查看当前线程映射的桥接会话状态。
- `/codex done`：让 Codex 总结并关闭当前线程会话。

服务还会启动一个本地 notify endpoint，用来接收 Codex `turn-ended` 通知并把结果同步回 Discord。

## Requirements

- macOS 上已安装 Codex app，默认 CLI 路径为 `/Applications/Codex.app/Contents/Resources/codex`
- Node.js 22+
- 一个 Discord Server，并且你有创建/邀请 Bot 的权限

## Install

```bash
npm install
cp .env.example .env
```

然后按下面的说明填写 `.env`。`.env` 已经被 `.gitignore` 排除，不要把 Bot token 或本机路径提交到仓库。

## 获取 Discord 环境信息

### 1. 创建 Discord Application 和 Bot

1. 打开 [Discord Developer Portal](https://discord.com/developers/applications)。
2. 点击 `New Application` 创建应用。
3. 在应用的 `General Information` 页面复制 `Application ID`，填入：

```env
DISCORD_APPLICATION_ID=你的 Application ID
```

4. 进入 `Bot` 页面，创建 Bot 并复制 `Token`，填入：

```env
DISCORD_TOKEN=你的 Bot Token
```

5. 在 `Bot` 页面的 `Privileged Gateway Intents` 中开启 `Message Content Intent`。本项目需要读取 Discord 线程里的普通消息内容，未开启时线程续聊会收不到正文。

Discord 官方文档可参考：

- [Gateway Intents](https://docs.discord.com/developers/events/gateway#gateway-intents)
- [Privileged Intents](https://support-dev.discord.com/hc/en-us/articles/6207308062871-What-are-Privileged-Intents)

### 2. 邀请 Bot 到服务器

在 Developer Portal 的 `OAuth2` / `URL Generator` 中生成邀请链接：

- Scopes: `bot`, `applications.commands`
- Bot Permissions: `View Channels`, `Send Messages`, `Create Public Threads`, `Send Messages in Threads`, `Read Message History`

打开生成的 URL，把 Bot 邀请到目标服务器。

### 3. 获取 Guild、Channel、User、Role ID

先在 Discord 客户端开启开发者模式：

1. `User Settings` -> `Advanced`
2. 打开 `Developer Mode`

然后通过右键菜单复制 ID：

- `DISCORD_GUILD_ID`：右键目标服务器，选择 `Copy Server ID`
- `DISCORD_CHANNEL_ID`：右键用于创建 Codex 线程的文字频道，选择 `Copy Channel ID`
- `DISCORD_ALLOWED_USER_IDS`：右键允许使用 Bot 的用户，选择 `Copy User ID`
- `DISCORD_ALLOWED_ROLE_IDS`：右键服务器角色，选择 `Copy Role ID`

`DISCORD_ALLOWED_USER_IDS` 和 `DISCORD_ALLOWED_ROLE_IDS` 至少填写一个。多个 ID 用英文逗号分隔：

```env
DISCORD_GUILD_ID=123456789012345678
DISCORD_CHANNEL_ID=123456789012345678
DISCORD_ALLOWED_USER_IDS=111111111111111111,222222222222222222
DISCORD_ALLOWED_ROLE_IDS=
```

如果你使用角色授权，确认对应用户在服务器里拥有该角色。

## 设置 Codex 和 Bridge 环境信息

`.env.example` 包含全部可配置项：

```env
DISCORD_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_GUILD_ID=
DISCORD_CHANNEL_ID=
DISCORD_ALLOWED_USER_IDS=
DISCORD_ALLOWED_ROLE_IDS=
DISCORD_PROXY_URL=
CODEX_BIN=/Applications/Codex.app/Contents/Resources/codex
CODEX_HOME=/Users/cxymds/.codex
BRIDGE_WORKSPACE_PATH=/Users/你的用户名/Documents
BRIDGE_DB_PATH=./data/bridge.sqlite
BRIDGE_NOTIFY_HOST=127.0.0.1
BRIDGE_NOTIFY_PORT=43765
BRIDGE_PUBLIC_BASE_URL=http://127.0.0.1:43765
```

变量说明：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DISCORD_TOKEN` | 是 | Discord Bot token，在 Developer Portal 的 `Bot` 页面获取。 |
| `DISCORD_APPLICATION_ID` | 是 | Discord Application ID，在 `General Information` 页面获取。 |
| `DISCORD_GUILD_ID` | 是 | 目标 Discord 服务器 ID。 |
| `DISCORD_CHANNEL_ID` | 是 | 用来接收 `/codex new` 并创建线程的父频道 ID。 |
| `DISCORD_ALLOWED_USER_IDS` | 条件必填 | 允许使用 Bot 的用户 ID，多个值用逗号分隔。 |
| `DISCORD_ALLOWED_ROLE_IDS` | 条件必填 | 允许使用 Bot 的角色 ID，多个值用逗号分隔。 |
| `DISCORD_PROXY_URL` | 否 | 访问 Discord API 需要代理时填写，例如 `http://127.0.0.1:7897`。 |
| `CODEX_BIN` | 否 | Codex CLI 路径，默认 `/Applications/Codex.app/Contents/Resources/codex`。 |
| `CODEX_HOME` | 否 | Codex 配置和会话目录，默认 `~/.codex`。 |
| `BRIDGE_WORKSPACE_PATH` | 否 | Discord 中 `/codex new project:<项目名>` 的相对路径根目录。例如设为 `/Users/你/Documents/KAI` 后，`project:rustfs` 会解析为 `/Users/你/Documents/KAI/rustfs`。不设置时相对路径会基于 bridge 进程当前目录解析。 |
| `BRIDGE_DB_PATH` | 否 | SQLite 状态库路径，默认 `./data/bridge.sqlite`。 |
| `BRIDGE_NOTIFY_HOST` | 否 | 本地通知服务监听地址，默认 `127.0.0.1`。 |
| `BRIDGE_NOTIFY_PORT` | 否 | 本地通知服务端口，默认 `43765`。 |
| `BRIDGE_PUBLIC_BASE_URL` | 否 | 对外展示的 bridge base URL；省略时根据 host 和 port 自动生成。 |

如果不确定 `CODEX_BIN` 是否正确，可以运行：

```bash
ls -l /Applications/Codex.app/Contents/Resources/codex
/Applications/Codex.app/Contents/Resources/codex --help
```

如果你使用自定义 Codex home，确认该目录中有 Codex 的配置和会话数据：

```bash
ls -la ~/.codex
```

## 配置 Codex Notify Hook

为了让本机 Codex turn 结束后主动通知 bridge，把 `~/.codex/config.toml` 里的 `notify` 指向本仓库脚本：

```toml
notify = ["node", "/Users/cxymds/Documents/discord-codex-bridge/scripts/codex-discord-notify.mjs", "turn-ended"]
```

如果 bridge notify endpoint 不是默认地址，可以给 notify 脚本设置 `BRIDGE_NOTIFY_URL`：

```bash
BRIDGE_NOTIFY_URL=http://127.0.0.1:43765/notify/turn-ended node scripts/codex-discord-notify.mjs turn-ended
```

修改 `~/.codex/config.toml` 前建议备份原来的 `notify` 配置。当前脚本会先把通知 POST 到 bridge，再尝试保留已有的本机 Computer Use 通知行为。

## Run

开发模式：

```bash
npm run dev
```

生产构建：

```bash
npm run build
npm start
```

启动成功后，终端会看到类似输出：

```text
Discord-Codex bridge running. Notify endpoint: http://127.0.0.1:43765/notify/turn-ended
```

第一次启动时服务会注册 Discord guild slash command。然后在配置的 Discord 频道中运行：

```text
/codex new project:/Users/你的用户名/Documents/your-project prompt:你好，确认桥接可用
```

如果已经设置 `BRIDGE_WORKSPACE_PATH`，也可以只写项目目录名：

```text
/codex new project:your-project prompt:你好，确认桥接可用
```

Bot 会先检查项目路径是否存在，再创建线程。Codex 的回复会出现在该线程中。之后直接在线程内发消息即可继续同一个 Codex 会话。

注意：Discord 线程内的后续消息当前通过 `codex exec resume` 执行，并把结果写回同一个 Codex 会话文件。这个路径会让 Codex 执行并把最终结果发回 Discord，但它不是 Codex Desktop 窗口的实时输入通道；如果同一个会话正打开在 Desktop 中，Desktop 可能不会把外部 CLI turn 按实时聊天顺序展示。等本机 Codex app-server control socket 可用后，bridge 才能切换到 `thread/resume` + `turn/start` 这种更接近 Desktop 的实时同步方式。

## 验证和排错

运行测试：

```bash
npm test
```

手动测试 notify endpoint：

```bash
printf '{"session_id":"manual-check","final_message":"notify ok"}' \
  | node scripts/codex-discord-notify.mjs turn-ended
```

如果 Discord 连接超时，可以先验证代理：

```bash
curl -I --proxy http://127.0.0.1:7897 --connect-timeout 10 https://discord.com/api/v10/gateway
```

然后在 `.env` 中设置：

```env
DISCORD_PROXY_URL=http://127.0.0.1:7897
```

常见问题：

- `At least one Discord allowed user id or role id is required`：`DISCORD_ALLOWED_USER_IDS` 和 `DISCORD_ALLOWED_ROLE_IDS` 都为空，至少填一个。
- `/codex new` 不出现：确认 Bot 邀请链接包含 `applications.commands` scope，且服务已成功启动并注册 guild command。
- 在线程里发消息没有反应：确认 `Message Content Intent` 已开启，且用户 ID 或角色 ID 在 allowlist 中。
- `Project path does not exist`：如果 `/codex new project:rustfs` 使用的是项目名而不是绝对路径，请确认 `.env` 中的 `BRIDGE_WORKSPACE_PATH` 指向包含 `rustfs` 的父目录。
- `Codex exited with code ...`：确认 `CODEX_BIN` 可执行，`project` 路径存在，并且 Codex app 已完成登录/授权。
- `Failed to start Codex command ... in ...`：通常表示 `CODEX_BIN` 不存在、不可执行，或后面的 `in <cwd>` 项目目录不存在/不可访问。
- notify 不回传：确认 bridge 正在运行，`BRIDGE_NOTIFY_PORT` 和 `~/.codex/config.toml` 中的 notify endpoint 一致。

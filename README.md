# Discord Codex Bridge

Discord Codex Bridge 是一个本机桥接服务，用来把 Discord 线程接到本机 Codex CLI / Codex Desktop 会话。启动后，授权用户可以在指定 Discord 频道里用 `/codex` 创建 Codex 会话，然后直接在线程里继续对话。

主要能力：

- 在 Discord 频道中用 `/codex new` 为指定本机项目创建 Codex 会话。
- 每个 Codex 会话对应一个 Discord 线程，后续线程消息会续接同一个 Codex 会话。
- 支持项目别名、项目 autocomplete、以及从 Codex 历史会话中发现项目。
- 支持把 Codex `turn-ended` notify 同步回 Discord。
- 支持 Codex Desktop app-server 投递，失败时可自动回退到 `codex exec resume`。
- 支持安装为 macOS launchd 用户后台服务。

## Requirements

- macOS
- Node.js 22+
- 已安装并登录 Codex app，默认 CLI 路径为 `/Applications/Codex.app/Contents/Resources/codex`
- 一个 Discord Server，并且你有创建应用、邀请 Bot、复制 Server / Channel / User / Role ID 的权限

## Quick Start

```bash
npm install
cp .env.example .env
```

编辑 `.env`，至少填写：

```env
DISCORD_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_GUILD_ID=
DISCORD_CHANNEL_ID=
DISCORD_ALLOWED_USER_IDS=
DISCORD_ALLOWED_ROLE_IDS=
BRIDGE_WORKSPACE_PATH=/Users/你的用户名/Documents
```

`DISCORD_ALLOWED_USER_IDS` 和 `DISCORD_ALLOWED_ROLE_IDS` 至少填写一个。多个 ID 用英文逗号分隔。

开发模式启动：

```bash
npm run dev
```

生产模式启动：

```bash
npm run build
npm start
```

启动成功后会看到类似输出：

```text
Discord-Codex bridge running. Notify endpoint: http://127.0.0.1:43765/notify/turn-ended
```

然后在配置的 Discord 频道中运行：

```text
/codex new project:/Users/你的用户名/Documents/your-project prompt:你好，确认桥接可用
```

如果设置了 `BRIDGE_WORKSPACE_PATH`，也可以使用相对项目目录：

```text
/codex new project:your-project prompt:你好，确认桥接可用
```

## Discord Bot Setup

### 1. 创建 Application 和 Bot

1. 打开 [Discord Developer Portal](https://discord.com/developers/applications)。
2. 点击 `New Application` 创建应用。
3. 在 `General Information` 页面复制 `Application ID`，填入 `DISCORD_APPLICATION_ID`。
4. 进入 `Bot` 页面，创建 Bot 并复制 `Token`，填入 `DISCORD_TOKEN`。
5. 在 `Bot` 页面的 `Privileged Gateway Intents` 中开启 `Message Content Intent`。

本项目需要读取 Discord 线程里的普通消息内容。未开启 `Message Content Intent` 时，线程续聊会收不到正文。

### 2. 邀请 Bot 到服务器

在 Developer Portal 的 `OAuth2` / `URL Generator` 中生成邀请链接：

- Scopes: `bot`, `applications.commands`
- Bot Permissions: `View Channels`, `Send Messages`, `Create Public Threads`, `Send Messages in Threads`, `Read Message History`

打开生成的 URL，把 Bot 邀请到目标服务器。

### 3. 获取 Discord ID

先在 Discord 客户端开启开发者模式：

1. `User Settings` -> `Advanced`
2. 打开 `Developer Mode`

然后通过右键菜单复制 ID：

- `DISCORD_GUILD_ID`：右键目标服务器，选择 `Copy Server ID`
- `DISCORD_CHANNEL_ID`：右键用于创建 Codex 线程的文字频道，选择 `Copy Channel ID`
- `DISCORD_ALLOWED_USER_IDS`：右键允许使用 Bot 的用户，选择 `Copy User ID`
- `DISCORD_ALLOWED_ROLE_IDS`：右键服务器角色，选择 `Copy Role ID`

## Slash Commands

- `/codex new project:<项目名或路径> prompt:<初始任务>`：创建一个 Discord 线程，并在对应项目目录中启动 Codex。
- `/codex project add name:<名称> path:<本机项目路径>`：登记项目名称，后续 `/codex new` 可以直接选择或输入该名称。
- `/codex project list`：查看已登记项目。
- `/codex project remove name:<名称>`：删除已登记项目。
- `/codex status`：查看当前线程映射的 bridge 会话状态。
- `/codex done`：让 Codex 总结并关闭当前线程会话。
- 在线程中继续发消息：续接同一个 Codex 会话。

`/codex new` 只能在 `.env` 中配置的 `DISCORD_CHANNEL_ID` 频道中使用。`/codex status`、`/codex done` 和线程续聊需要在对应 Codex 线程里使用。

## Project Resolution

`/codex new project:<value>` 会按以下顺序解析项目：

1. 已登记的项目名称。
2. Codex 历史会话中唯一同名的项目。
3. 绝对路径。
4. `BRIDGE_WORKSPACE_PATH` 下的相对路径。
5. 如果没有设置 `BRIDGE_WORKSPACE_PATH`，相对路径基于 bridge 进程当前目录解析。

解析完成后，bridge 会先检查项目路径是否存在，再创建 Discord 线程。

项目别名示例：

```text
/codex project add name:rustfs path:/Users/你的用户名/Documents/KAI/rustfs
/codex new project:rustfs prompt:检查测试失败原因
```

## Configuration

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
CODEX_TURN_DELIVERY=auto
CODEX_FULL_ACCESS=false
CODEX_APP_SERVER_SOCKET=/Users/cxymds/.codex/app-server-control/app-server-control.sock
CODEX_APP_SERVER_AUTO_START=false
BRIDGE_WORKSPACE_PATH=/Users/cxymds/Documents
BRIDGE_DB_PATH=./data/bridge.sqlite
BRIDGE_NOTIFY_HOST=127.0.0.1
BRIDGE_NOTIFY_PORT=43765
BRIDGE_PUBLIC_BASE_URL=http://127.0.0.1:43765
```

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
| `CODEX_TURN_DELIVERY` | 否 | Discord 线程回复投递方式。`auto` 优先写入 Codex Desktop UI，失败时回退到 CLI；`desktop` 严格要求 Desktop app-server；`cli` 只使用 CLI resume。默认 `auto`。 |
| `CODEX_FULL_ACCESS` | 否 | 设为 `true` 时，bridge 启动的 Codex CLI 会话会附加 `--dangerously-bypass-approvals-and-sandbox`。默认 `false`。 |
| `CODEX_APP_SERVER_SOCKET` | 否 | Codex Desktop app-server control socket 路径，默认 `CODEX_HOME/app-server-control/app-server-control.sock`。 |
| `CODEX_APP_SERVER_AUTO_START` | 否 | 是否由 bridge 启动本机 Codex app-server control socket。默认 `false`。 |
| `BRIDGE_WORKSPACE_PATH` | 否 | 相对项目名的解析根目录。例如设为 `/Users/你/Documents/KAI` 后，`project:rustfs` 会解析为 `/Users/你/Documents/KAI/rustfs`。 |
| `BRIDGE_DB_PATH` | 否 | SQLite 状态库路径，默认 `./data/bridge.sqlite`。 |
| `BRIDGE_NOTIFY_HOST` | 否 | 本地通知服务监听地址，默认 `127.0.0.1`。 |
| `BRIDGE_NOTIFY_PORT` | 否 | 本地通知服务端口，默认 `43765`。 |
| `BRIDGE_PUBLIC_BASE_URL` | 否 | 对外展示的 bridge base URL；省略时根据 host 和 port 自动生成。 |

`.env` 已经被 `.gitignore` 排除，不要把 Bot token 或本机路径提交到仓库。

## Codex Notify Hook

为了让本机 Codex turn 结束后主动通知 bridge，把 `~/.codex/config.toml` 里的 `notify` 指向本仓库脚本：

```toml
notify = ["node", "/Users/cxymds/Documents/discord-codex-bridge/scripts/codex-discord-notify.mjs", "turn-ended"]
```

如果 bridge notify endpoint 不是默认地址，可以给 notify 脚本设置 `BRIDGE_NOTIFY_URL`：

```bash
BRIDGE_NOTIFY_URL=http://127.0.0.1:43765/notify/turn-ended node scripts/codex-discord-notify.mjs turn-ended
```

修改 `~/.codex/config.toml` 前建议备份原来的 `notify` 配置。当前脚本会先把通知 POST 到 bridge，再尝试保留已有的本机 Computer Use 通知行为。

## Codex Desktop Delivery

默认 `CODEX_TURN_DELIVERY=auto`。线程中的后续 Discord 消息会先尝试通过 Codex Desktop app-server 的 `thread/resume` + `turn/start` 投递到 Desktop UI。这样同一个会话打开在 Codex Desktop 中时，Discord 消息会作为新的用户输入进入界面并启动请求。

如果本机 Codex Desktop 没有开放 app-server control socket，`auto` 模式会回退到 `codex exec resume`，Discord 线程仍能收到最终回复。

相关配置：

```env
CODEX_TURN_DELIVERY=auto
CODEX_APP_SERVER_AUTO_START=false
```

- 想严格要求 Desktop UI 同步：设为 `CODEX_TURN_DELIVERY=desktop`。
- 想只走 CLI resume：设为 `CODEX_TURN_DELIVERY=cli`。
- 想让 bridge 启动时自动创建本机 control socket：设为 `CODEX_APP_SERVER_AUTO_START=true`。

## Full Access Mode

如果 Discord 发起的 Codex CLI 会话在 `git push`、跨目录写入或需要网络/系统权限的命令上报权限不足，可以在 `.env` 中开启：

```env
CODEX_FULL_ACCESS=true
```

开启后，bridge 通过 CLI 新建或续接会话时会使用 Codex 的 `--dangerously-bypass-approvals-and-sandbox` 参数。这个选项等价于给 Discord 授权用户执行本机命令的能力，建议同时确认 `DISCORD_ALLOWED_USER_IDS` / `DISCORD_ALLOWED_ROLE_IDS` 只包含你信任的人，并保护好 Discord Bot token。

使用 Desktop app-server 投递的回合仍由当前 Codex Desktop 线程自身的权限状态决定。如果想让所有 Discord 后续消息都走 CLI 权限策略，可以设置：

```env
CODEX_TURN_DELIVERY=cli
```

## macOS Background Service

安装为当前 macOS 用户的 launchd 服务：

```bash
npm run service:install
```

安装脚本会：

- 必要时先执行 `npm run build`
- 写入 `~/Library/LaunchAgents/com.local.discord-codex-bridge.plist`
- 设置工作目录为当前仓库
- 使用生产入口 `dist/src/index.js`
- 设置 `RunAtLoad=true` 和 `KeepAlive=true`

默认不会把 stdout/stderr 写入日志文件。如果需要记录日志，用 `LOG_TO_FILES=true` 重新安装服务：

```bash
LOG_TO_FILES=true npm run service:install
```

开启后会写入：

- `logs/bridge.out.log`
- `logs/bridge.err.log`

服务管理命令：

```bash
npm run service:status
npm run service:restart
npm run service:stop
npm run service:start
npm run service:uninstall
```

如果 launchd 使用的 Node 路径需要手动指定，可以在安装时设置 `NODE_BIN`：

```bash
NODE_BIN=/opt/homebrew/bin/node npm run service:install
```

更新代码后，重新构建并重启服务：

```bash
npm install
npm run build
npm run service:restart
```

## Development

常用命令：

```bash
npm run dev
npm run build
npm test
```

手动测试 notify endpoint：

```bash
printf '{"session_id":"manual-check","final_message":"notify ok"}' \
  | node scripts/codex-discord-notify.mjs turn-ended
```

检查 Codex CLI 路径：

```bash
ls -l /Applications/Codex.app/Contents/Resources/codex
/Applications/Codex.app/Contents/Resources/codex --help
```

## Troubleshooting

- `At least one Discord allowed user id or role id is required`：`DISCORD_ALLOWED_USER_IDS` 和 `DISCORD_ALLOWED_ROLE_IDS` 都为空，至少填一个。
- `/codex new` 不出现：确认 Bot 邀请链接包含 `applications.commands` scope，且服务已成功启动并注册 guild command。
- `/codex new` 的项目候选不出现：确认服务已重启并重新注册 slash command；Discord guild command 可能需要几十秒刷新。
- 在线程里发消息没有反应：确认 `Message Content Intent` 已开启，且用户 ID 或角色 ID 在 allowlist 中。
- `Project path does not exist`：如果 `/codex new project:rustfs` 使用的是项目名而不是绝对路径，请确认 `.env` 中的 `BRIDGE_WORKSPACE_PATH` 指向包含 `rustfs` 的父目录。
- `Codex exited with code ...`：确认 `CODEX_BIN` 可执行，`project` 路径存在，并且 Codex app 已完成登录/授权。
- `Failed to start Codex command ... in ...`：通常表示 `CODEX_BIN` 不存在、不可执行，或后面的 `in <cwd>` 项目目录不存在/不可访问。
- `Codex Desktop app-server proxy failed`：严格 Desktop UI 投递模式无法连接 app-server control socket。可以设置 `CODEX_APP_SERVER_AUTO_START=true` 让 bridge 启动本机 control socket；默认 `auto` 模式会自动回退到 CLI resume。
- Discord 连接超时：如果终端访问 Discord 需要代理，在 `.env` 中设置 `DISCORD_PROXY_URL=http://127.0.0.1:7897`。
- notify 不回传：确认 bridge 正在运行，`BRIDGE_NOTIFY_PORT` 和 `~/.codex/config.toml` 中的 notify endpoint 一致。

代理可用性可以这样检查：

```bash
curl -I --proxy http://127.0.0.1:7897 --connect-timeout 10 https://discord.com/api/v10/gateway
```

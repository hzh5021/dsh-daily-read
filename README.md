# dsh-daily-read

注册 `/daily`，把「去读最新那篇日报」变成一次点击；读完让模型说自己的理解，而不是复述报告。

## 它做什么

它服务的是「日报有人写、但没人读」这种情况：另一个插件每天往自己的输出目录里落一篇 `YYYY-MM-DD.md`，这个插件只负责把「去读最新那一篇」变成一条命令和一个按钮。

敲 `/daily` 时，它扫输出目录、挑日期最新的一篇，然后往当前会话注入一条 user 消息——内容是「去读 <路径>」，再加一句要求：读原文、说自己的理解、不要复述报告里的结论。为什么只给路径、不把正文塞进去：正文塞进去，模型只会念报告；只给路径，它才会去翻原文。

侧边栏还有一个「读日报」条目，点开是主区里的一页：一个按钮加一句说明。按钮走内核的命令接口发同一条 `/daily`，送出去就回对话界面——命令回执和模型读完说的那段话，都在对话里。

## 装

```
dsh plugin add hzh5021/dsh-daily-read
```

手工四步：

1. 把包放进 `~/.dsh/plugins/dsh-daily-read/`。
2. profile 的 `package.json` 里 `dependencies` 加一条（本机口径：`"dsh-daily-read": "file:../../plugins/dsh-daily-read"`），并在 profile 的 `node_modules/` 下留一个同名联接。
3. 同一份 `package.json` 的 `dsh.profile.bundles` 里加上 `"dsh-daily-read"`。
4. 重启 DSH。

这个包带前端那一半（`package.json` 里声明了 `dsh.client`），设置页/侧栏那部分跟着 profile 一起加载；插件行由本包自己的 `cordis.patch.yml` 插入，profile 的 `cordis.yml` 是生成物，不要手改。

## 配置

无配置项。命令名、日报目录、注入的文案都写在代码里。

- 日报目录固定是 `~/.dsh/bili-duty/out`（`.dsh` 下、当前用户的 home 里）。
- 挑文件只认文件名形如 `YYYY-MM-DD.md` 的那几个，按字典序取最后一个。
- 命令名是 `daily`，描述是「读最新那篇刷B站日报（读完说自己的理解，不复述）」。

## 怎么工作

**宿主那半**（`lib/index.js`）：`inject = ["commands"]`，只用命令注册表。`apply()` 里注册一条命令：

- `newestReport()` 先 `readdir` 日报目录；目录不在、或者里面没有匹配的文件名，就返回 `null`。
- 找到了：用 `agent.steer()` 注入 user 消息。找不到日报时返回 `{ kind: "error", text: "还没找到日报：<目录> 里没有 YYYY-MM-DD.md" }`，错误信息里带目录，方便判断是不是上游插件没跑。
- 宿主没暴露 `agent.steer` 时返回错误，而不是静默失败。

**客户端那半**（`lib/client.js`）：按 `window.__ModuleLoader__.load({ id, factory })` 注册，挂两个槽——`sidebar.panellist`（侧栏条目，id `daily-read`，order 30，标签「读日报」，带一个自绘 SVG 图标）和 `main`（同一个 key 的主区页面）。

- **当前会话从哪儿来**：面板一打开，主区已经换成它自己了，「当前会话」取不到实时值。所以客户端订阅 `ctx.sessions.list`，把最近一次被主区保留（`retainedBy.mainView > 0`）的会话记在 `lastSessionId` 里，按钮就发到这个会话。
- **为什么走 RPC，不是替用户敲键盘**：最初那版想「替你把 `/daily` 敲进输入框」，两处都站不住——(a) 布局的 `main` 是 keyed 槽，点开面板就等于把对话视图整个卸下来，输入框根本不在 DOM 里；(b) 就算在，DSH 的输入框是 Lexical 富文本（`contenteditable`），`textContent` 加一个 input 事件塞不进去。现在走 `ctx.remote.commands.execute(sessionId, "/daily", [])`——命令面板里敲回车走的正是这条路，纯 RPC，不碰 DOM。
- **客户端 `inject` 写的是服务短名**（`["slots", "sessions", "remote", "remote.commands", "layout"]`），不是包全名。写包全名会让纤维永远 pending，web boot 报 `1 entry did not activate`。包全名只出现在 `package.json` 的 `dsh.client.inject` 里，两处不是一个写法。
- 送出去之后调 `ctx.layout.selectPanel(null)` 回到对话界面；任何一步失败都会把原因写在面板上，而不是默默什么都不做。

## 边界

- 依赖第三方插件 **dsh-bili-scroll** 的日报目录 `~/.dsh/bili-duty/out`。那个目录不在、或者里面没有 `YYYY-MM-DD.md`，`/daily` 只回一条错误。
- 日报目录写死，没有配置项；要换目录得改代码。
- 需要宿主暴露 `agent.steer`。
- 客户端需要宿主暴露 `remote.commands`；没有就提示回对话里手动敲。极端情况下（主区没保留任何会话）认不出当前会话，面板会提示先点开一个会话再回来按。
- 「点按钮」这条路径本身没有自动化测试；命令那条（`/daily`）是宿主注册表在跑。

## 冒烟测试

这个包没有自带 `test/`（插件本体只有一条命令，验证要靠真宿主）。手工验法：装好重启，随便开一段会话敲 `/daily`，看模型有没有去读那篇文件。

## English

**What it does** — Registers `/daily`, which finds the newest `YYYY-MM-DD.md` report under `~/.dsh/bili-duty/out` and steers the session to read it and say what it understood, rather than repeating the report. A sidebar entry plus a one-button panel runs the same command through `remote.commands.execute`.

**Install** — `dsh plugin add hzh5021/dsh-daily-read`, or drop the package into `~/.dsh/plugins/dsh-daily-read/`, register it in the profile `package.json` (`dependencies` + `dsh.profile.bundles`) and restart DSH.

**Config** — none; the report directory is hard-coded to `~/.dsh/bili-duty/out`.

**Requirements** — DSH exposing `commands` and (for the panel) `remote.commands`; the third-party `dsh-bili-scroll` plugin producing the daily reports; Node 18+; no external dependencies.

**License** — MIT.

MIT 许可。
# dsh-balance-pill

DeepSeek Harness（DSH）插件：在界面右下角常驻一枚余额胶囊，实时显示**当前登录的 DeepSeek 账户**余额。点击展开详情，余额偏低时自动变色。

> A floating corner pill for DeepSeek Harness that shows your signed-in DeepSeek account balance — no API key required.

## 特性

- **不用填 API Key**：直接读 DSH 已登录的 DeepSeek 账户钱包（`deepseekAccount`），和你实际调用模型的是同一个账户。
- **不轮询**：连上就推一次，每轮对话结束推一次，打开面板/点刷新再拉一次。
- **低余额提醒**：默认 ¥10 变黄、¥5 变红，悬停有说明。
- **一点即达**：详情卡里直接跳平台「充值」「用量」页。
- **不落盘**：不保存任何余额历史或用量数据。

## 界面

胶囊在右下角，收起时只显示金额：

```
● ¥12.07
```

点开是一张卡片：总可用余额、充值余额、赠金、账户状态、更新时间，以及「刷新 / 去充值 / 用量」三个按钮。

## 安装

要求：DSH Desktop 或 `dsh web`，并已在设置里登录 DeepSeek 账号（模型 provider 为 `deepseek-account`）。

```bash
git clone https://github.com/g65tph4ycm-svg/dsh-balance-pill.git
```

然后把克隆下来的目录装进 DSH：

- 在 DSH 的插件（Plugins）页面选择从本地目录安装，或
- 让 agent 执行 `plugin_manager` 的 `install_bundle`，`target` 指向该目录的绝对路径。

安装完成后刷新页面，右下角就会出现胶囊。卸载用 `remove_bundle` 指向 `dsh-balance-pill`。

## 配置阈值

插件自带默认阈值，想改就覆盖 profile 的 `cordis.patch.yml`：

```yaml
- id: dsh-balance-pill
  name: 'dsh-balance-pill'
  config:
    warnBelow: 20
    dangerBelow: 8
```

改完刷新页面生效。

## 工作原理

```
┌──────────── Host ────────────┐        ┌────────── Browser ──────────┐
│ deepseekAccount.getBalance() │        │ client.js                   │
│        ↓                     │  SSE   │  shell.overlay 里的胶囊      │
│ /dsh-balance-pill/stream ────┼───────→│  单次连接，持续接收快照       │
│ agent/status → idle 触发刷新  │        │  点开卡片时 POST 请求刷新     │
└──────────────────────────────┘        └─────────────────────────────┘
```

- `index.js`（Host 半）：读取钱包余额，合并赠金与充值钱包，按币种合计；用 Server-Sent Events 推给页面。监听 `agent/status`，每轮对话 `idle` 时刷新一次。
- `client.js`（Client 半）：注册到 `shell.overlay`，渲染胶囊与详情卡，样式只依赖 `--dsw-alias-*` 主题变量。

## 隐私

- 余额请求全部在 Host 进程里完成，浏览器只拿到数字和两个平台链接。
- 自定义的 SSE 路由只绑定 DSH 自己的本机监听地址，且不返回 CORS 头，跨站页面读不到内容。
- 插件不读取、不存储你的 API Key 或登录令牌。

## 已知限制

- **没有用量接口**：DeepSeek 只开放了余额查询，所以这里只有钱包余额，没有 token 用量、请求数或消费明细。
- **扣费有延迟**：平台余额到账通常比对话结束晚几秒，刚聊完看到的数字可能还没变。
- **只在 Web/Desktop 生效**：纯 CLI 场景没有可渲染的界面。
- **文案只有中文**：运行时文案暂未接入 DSH 的 locale 服务，插件标题/描述已提供中英两份。

## License

[MIT](LICENSE)

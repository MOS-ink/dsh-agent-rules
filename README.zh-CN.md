# dsh-agent-rules

DeepSeek Harness 插件：在设置里加一页 **规则与记忆**，把长期生效的预设规则收在一个列表里统一管理。

规则渲染进 `~/.dsh/AGENTS.md` 的托管块。宿主自带的 `@deepseek-ai/dsh-agent-instructions` 会在每个会话的首次请求读取该文件作为工作区指令，因此规则全局生效，且不占用 system 段。

## 行为

- **一处存储，一份落地。** 面板把规则写进 `~/.dsh/agent-rules.json`，并重新渲染 `~/.dsh/AGENTS.md` 的托管块。
- **手写内容不被覆盖。** `<!-- dsh-agent-rules:start -->` 与 `<!-- dsh-agent-rules:end -->` 之外的内容原样保留；检测到手写内容时，面板给出导入入口。
- **停用不等于删除。** 停用的规则从 `AGENTS.md` 里消失，但文本与 id 仍留在 JSON 中。
- **不改写系统提示词。** 插件不挂 prompt 组装，只写官方指令加载器本来就会读的那个文件。
- **生效范围。** 规则在**新会话**开始时生效。已经打开的会话沿用创建时的指令。

## 安装

在插件页添加下面的市场索引源，然后安装 `dsh-agent-rules`：

```
https://cdn.jsdelivr.net/gh/MOS-ink/dsh-agent-rules@main/market/index.json
```

GitHub raw 提供同一份文档，不带 CDN 缓存：

```
https://raw.githubusercontent.com/MOS-ink/dsh-agent-rules/main/market/index.json
```

从本地目录安装：

```powershell
dsh plugin --profile <profile> add link:<本目录绝对路径>
```

随后把 `dsh-agent-rules` 加进 profile `package.json` 的 `dsh.profile.bundles`，重启应用。Client 半侧由宿主下发，刷新页面不会装载它。

## 使用

设置 → **规则与记忆**。

| 操作 | 效果 |
| --- | --- |
| 添加规则 | 在列表顶部展开编辑器；保存时同时写两个文件 |
| 点击规则文本 / 齿轮 | 就地编辑 |
| 圆点开关 | 停用而不删除；该条不再写入 `AGENTS.md` |
| 垃圾桶 | 从存储与 `AGENTS.md` 中删除 |
| 从 AGENTS.md 导入 | 托管块之外存在手写内容时出现 |

## 存储

`~/.dsh/agent-rules.json`

```json
{
  "version": 1,
  "rules": [
    { "id": "r1", "text": "回答先给结论。", "enabled": true }
  ]
}
```

`~/.dsh/AGENTS.md` 中的渲染结果：

```markdown
<!-- dsh-agent-rules:start -->
- 回答先给结论。
<!-- dsh-agent-rules:end -->
```

多行规则以续行缩进的形式挂在同一个列表项下。

## 面板展示的上下文来源

| 来源 | 加载方 |
| --- | --- |
| `~/.dsh/AGENTS.md` | `dsh-agent-instructions`，用户全局作用域 |
| `~/.agents/AGENTS.md` | 共享 agents 根，内容完全相同时折叠 |
| 各项目目录下的 `CLAUDE.md` | 仅项目作用域；用户全局作用域没有 `CLAUDE.md` |

## 市场索引

`market/index.json` 遵循插件市场索引格式 1，发布前用 `@deepseek-ai/dsh-plugin-market-index` 校验：

```powershell
node scripts/validate-index.mjs market/index.json https://raw.githubusercontent.com/MOS-ink/dsh-agent-rules/main/market/index.json
```

## 开发

```powershell
node --test
node --check index.js
node --check client.js
```

Host 半侧注册一个前缀路由 `/dsh-agent-rules`，经 `connection.requestRejection` 做信任栅栏。Client 半侧注册 `settings.section` 条目，id 为 `agent-rules`。

| 文件 | 职责 |
| --- | --- |
| `rules.js` | 数据模型、markdown 渲染、块合并、导入解析（无 IO） |
| `index.js` | Host 插件：路由、存储、文件渲染 |
| `client.js` | 设置页面（`window.__ModuleLoader__` bundle） |

## 许可

MIT

# Deep Code CLI 本地编译与配置运行教程

> 适用场景：从源码编译 `deepcode-cli`，并配置 API 密钥后本地运行。
> 本文基于 `docs/configuration.md` 与 `docs/quickstart.md` 整理，针对**源码本地构建**的方式编写。

---

## 0. 环境要求

| 依赖 | 版本要求 | 检查命令 |
| ---- | -------- | -------- |
| Node.js | ≥ 22（`.nvmrc` 指定 22） | `node --version` |
| npm | ≥ 10（仓库锁定 10.9.4） | `npm --version` |
| 一个可用的 DeepSeek API Key | — | — |

---

## 1. 编译

```bash
cd /d/code/gv/deepcode-cli
npm install        # 安装依赖（已安装可跳过）
npm run build      # 完整编译
```

编译成功后，产物为 `packages/cli/dist/cli.js`（可执行二进制，`bin` 指向它）。

验证编译产物：

```bash
node packages/cli/dist/cli.js --version   # 输出 0.4.3
node packages/cli/dist/cli.js --help      # 显示帮助信息
```

常用命令：

| 命令 | 作用 |
| ---- | ---- |
| `npm run build` | 完整编译（typecheck + esbuild 打包 + 拷贝资源） |
| `npm run bundle` | 仅 esbuild 打包（跳过类型检查，更快） |
| `npm run typecheck` | 仅 TS 类型检查 |
| `npm run clean` | 清理构建产物 |

> **注意**：构建时会通过 `generate-git-commit-info.js` 嵌入当前 `git HEAD` 的哈希作为版本信息（例如 `0.4.3 (35ef5d1)`）。

---

## 2. 配置 API Key

CLI 运行时按以下优先级读取配置（数字小 → 优先级低）：

1. 默认值
2. 用户设置 `~/.deepcode/settings.json`
3. 项目设置 `<项目根>/.deepcode/settings.json`
4. 系统环境变量（带 `DEEPCODE_` 前缀）

### 2.1 推荐：用户级配置（全局生效）

创建 `~/.deepcode/settings.json`（Windows 上即 `C:\Users\<用户名>\.deepcode\settings.json`）：

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "sk-你的密钥"
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max"
}
```

常用字段说明：

| 字段 | 说明 |
| ---- | ---- |
| `env.MODEL` | 模型名称，推荐 `deepseek-v4-pro`，也可用 `deepseek-v4-flash` |
| `env.BASE_URL` | API 地址，默认 `https://api.deepseek.com` |
| `env.API_KEY` | DeepSeek API Key |
| `thinkingEnabled` | 是否启用思考模式（V4 系列默认启用） |
| `reasoningEffort` | 推理强度，`"low"` / `"high"` / `"max"`（默认 `max`） |

### 2.2 备选：项目级配置（仅当前项目生效）

在项目根目录创建 `.deepcode/settings.json`，内容同上。项目设置会**覆盖**用户设置。

### 2.3 备选：环境变量（临时 / CI 场景）

```bash
DEEPCODE_API_KEY=sk-你的密钥 DEEPCODE_BASE_URL=https://api.deepseek.com DEEPCODE_MODEL=deepseek-v4-pro deepcode
```

> 环境变量优先级最高，适合临时切换或脚本调用，不建议长期使用。

### 2.4 加密存储 API_KEY（推荐，避免明文落盘）

如果不希望 `API_KEY` 以明文形式存在 settings.json 里，可以用内置的对称加密功能：

```bash
# 方式 A：从 stdin 管道输入（推荐，不进入 shell 历史）
echo 'sk-你的密钥' | node packages/cli/dist/cli.js config encrypt

# 方式 B：直接传参（明文会出现在 shell 历史中，不推荐）
node packages/cli/dist/cli.js config encrypt --value 'sk-你的密钥'
```

执行后：

- `~/.deepcode/settings.json` 中的 `env.API_KEY` 被替换为 `enc:...` 密文；
- 主密钥保存在 `~/.deepcode/.secret`（与 settings.json 同目录），通过系统文件权限保护（Windows `icacls` 收紧 ACL，Unix `chmod 600`）。

运行时 Deep Code 读取到 `enc:` 前缀的值会自动解密后使用，无需额外操作。

> **重要**：
> - `.secret` 文件一旦丢失或损坏，加密的 API_KEY 将无法解密，需要重新执行 `config encrypt`。
> - 加密只防止 settings.json 被直接读取时泄露明文；若攻击者同时拿到 `.secret` 和 settings.json，仍可解密。
> - 项目级 `.deepcode/settings.json` 目前不参与加密流程，`config encrypt` 仅写入用户级配置。

---

## 3. 运行

### 3.1 交互式 TUI（最常用）

```bash
cd /d/code/gv/deepcode-cli
node packages/cli/dist/cli.js
```

或带着初始问题启动：

```bash
node packages/cli/dist/cli.js -p "总结这个仓库，并说明如何运行它"
```

### 3.2 非交互单次执行（`-x -p` 组合）

```bash
node packages/cli/dist/cli.js -x -p "Say hello in one word"
```

> 如果报 `API key not found`，说明第 2 节的配置未生效——检查 settings.json 路径、JSON 格式、`API_KEY` 是否填入真实密钥。

### 3.3 常用启动参数

| 参数 | 说明 |
| ---- | ---- |
| `-p, --prompt <text>` | 启动时提交一条 prompt |
| `-x, --exec` | 非交互模式运行一条 prompt（需配合 `-p`） |
| `-r, --resume [id]` | 恢复指定会话；不带 id 显示选择器 |
| `-l, --last` | 恢复当前项目最近一次会话 |
| `-v, --version` | 显示版本号 |

### 3.4 全局安装（可选）

如果想在任意目录直接使用 `deepcode` 命令，可全局安装：

```bash
npm install -g @vegamo/deepcode-cli
deepcode
```

---

## 4. 首次提问建议

从只读任务开始，验证链路是否跑通：

```text
总结这个仓库，并说明如何运行它。
```

```text
找出主要入口文件，并解释请求流程。
```

确认正常后再尝试代码修改类任务。

---

## 5. 常见问题排查

| 现象 | 排查方向 |
| ---- | -------- |
| `API key not found` | 确认 `~/.deepcode/settings.json` 或项目 `.deepcode/settings.json` 存在且 `API_KEY` 已填入 |
| `Failed to decrypt API_KEY` | `.secret` 文件缺失/损坏或密文被篡改，重新执行 `deepcode config encrypt` |
| 模型 404 / 模型不存在 | 确认 `MODEL` 名称正确（`deepseek-v4-pro` / `deepseek-v4-flash`） |
| 401 Unauthorized | API Key 无效或已过期，去 DeepSeek 控制台重新生成 |
| 构建报错 | 先 `npm install` 确保依赖齐全；检查 Node 版本 ≥ 22 |

---

## 6. 进阶参考

- 完整配置项：[docs/configuration.md](docs/configuration.md)
- 快速开始：[docs/quickstart.md](docs/quickstart.md)
- 权限策略：[docs/permission.md](docs/permission.md)
- MCP 外部工具：[docs/mcp.md](docs/mcp.md)
- 任务完成通知：[docs/notify.md](docs/notify.md)

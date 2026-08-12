# ustcode

USTC Coding Agent
---

### 安装

```bash
# 直接安装 (YOLO)
curl -fsSL https://ustcode.enthusjast.cc/install | bash
```

**Windows**（PowerShell）：

```powershell
irm https://ustcode.enthusjast.cc/install.ps1 | iex
# 或下载后运行
powershell -ExecutionPolicy Bypass -File install.ps1
```

#### 安装目录

脚本将二进制安装到 `$HOME/.ustcode/bin`，并默认把该目录加入 `$PATH`：

```bash
# 指定版本安装
curl -fsSL https://ustcode.enthusjast.cc/install | bash -s -- --version 1.0.0

# 使用本地二进制（跳过下载）
curl -fsSL https://ustcode.enthusjast.cc/install | bash -s -- --binary /path/to/ustcode

# 不修改 shell 配置
curl -fsSL https://ustcode.enthusjast.cc/install | bash -s -- --no-modify-path
```

#### 卸载

```bash
# 下载并运行卸载脚本（移除二进制和 PATH 配置）
curl -fsSL https://ustcode.enthusjast.cc/uninstall | bash

# 连同用户数据（日志、会话、配置）一起删除
curl -fsSL https://ustcode.enthusjast.cc/uninstall | bash -s -- --purge
```

**Windows**（PowerShell）：

```powershell
irm https://ustcode.enthusjast.cc/uninstall.ps1 | iex
# 连同用户数据一起删除
irm https://ustcode.enthusjast.cc/uninstall.ps1 | iex -ArgumentList "-Purge"
```

### Agents

UstCode 内置两种 Agent，可用 `Tab` 键快速切换：

- **build** - 默认模式，具备完整权限，适合开发工作
- **plan** - 只读模式，适合代码分析与探索
  - 默认拒绝修改文件
  - 运行 bash 命令前会询问
  - 便于探索未知代码库或规划改动

另外还包含一个 **general** 子 Agent，用于复杂搜索和多步任务，内部使用，也可在消息中输入 `@general` 调用。

### 模型与供应商

**USTC 供应商已内置**（USTC 词元计划，OpenAI 兼容 API），开箱即用，无需手动配置 provider。

**1. 设置 API Key**

API Key 需要从环境变量读取：

```bash
export USTC_API_KEY="你的 USTC API Key"
```

**2. 指定模型**

```bash
ustcode --model USTC/qwen-chat
```

内置的模型（完整列表可用 `ustcode models` 查看；上下文长度与定价见 [USTC-API-PRICING.md](USTC-API-PRICING.md)）：

| 模型 ID | 说明 |
| --- | --- |
| `USTC/deepseek-v4-pro` | DeepSeek V4 Pro（推理） |
| `USTC/deepseek-v4-flash` | DeepSeek V4 Flash（推理） |
| `USTC/deepseek-v4-flash-ascend` | DeepSeek V4 Flash Ascend（推理） |
| `USTC/deepseek-v4-flash-ascend1` | DeepSeek V4 Flash Ascend 1（推理） |
| `USTC/glm-5.2` | GLM 5.2 |
| `USTC/glm-5.2-107` | GLM 5.2 (107) |
| `USTC/k3` | K3 |
| `USTC/qwen3.6-chat` | Qwen 3.6 Chat |
| `USTC/qwen3.6-reasoner` | Qwen 3.6 Reasoner（推理） |
| `USTC/qwen-chat` | Qwen Chat |
| `USTC/qwen-reasoner` | Qwen Reasoner（推理） |
| `USTC/qwen3-embedding` | Qwen3 Embedding（向量嵌入） |
| `USTC/qwen3-reranker` | Qwen3 Reranker（重排序） |
| `USTC/smart/reasoning` | Smart Reasoning（推理） |
| `USTC/smart/default` | Smart Default |
| `USTC/unlimited-ocr` | OCR（支持图像输入） |

**3. 其他供应商**

UstCode 采用配置驱动，不依赖 models.dev。如需使用其他 OpenAI 兼容的模型服务，在配置文件（`ustcode.jsonc`）中按格式添加即可：

```jsonc
{
  "provider": {
    "MyProvider": {
      "name": "MyProvider",
      "api": "https://example.com/v1",
      "npm": "@ai-sdk/openai-compatible",
      "env": ["MY_PROVIDER_API_KEY"],
      "models": {
        "my-model": { "name": "My Model", "limit": { "context": 128000 } }
      }
    }
  }
}
```

# USTC LLM 用量 / 余量查询 API 手册

> 站点:`https://api.llm.ustc.edu.cn`
> 引擎:LiteLLM **v1.92.0** (Enterprise Edition) 代理网关
> 本文档基于 2026-08-11 对本站点 `/openapi.json` 的实测整理,所有字段均来自真实响应。

---

## 目录

1. [站点与认证](#1-站点与认证)
2. [快速开始:一句话查余量](#2-快速开始一句话查余量)
3. [接口总览](#3-接口总览)
4. [预算机制详解](#4-预算机制详解)
5. [各接口详细说明](#5-各接口详细说明)
   - 5.1 查 Key 余量 — `GET /key/info`
   - 5.2 查用户信息与名下所有 Key — `GET /user/info`
   - 5.3 列出可见 Key — `GET /key/list`
   - 5.4 花费明细 — `GET /spend/logs` / `GET /spend/logs/v2`
   - 5.5 每日用量 — `GET /user/daily/activity` / `.../aggregated`
   - 5.6 全局报表(管理员)— `GET /global/spend/report`
   - 5.7 辅助接口 — `/health`, `/v1/models`, `/key/health`
6. [权限对照表](#6-权限对照表)
7. [一键查询脚本](#7-一键查询脚本)
8. [Web 控制台](#8-web-控制台)
9. [常见错误与排障](#9-常见错误与排障)
10. [安全提示](#10-安全提示)

---

## 1. 站点与认证

`api.llm.ustc.edu.cn` 是中国科学技术大学部署的 **LiteLLM** 代理网关,以 OpenAI 兼容格式(`/v1/chat/completions` 等)提供多种模型,同时内建一整套用量/余量/花费追踪的**管理 API**。

### 1.1 认证方式

所有管理接口统一使用 **Bearer Token** 认证,即你在调用模型时使用的那个 API Key:

```
Authorization: Bearer sk-xxxx
```

在 OpenAPI 规范中标记为 `APIKeyHeader`。**同一个 key 既能调模型,也能查自己的用量。**

### 1.2 账号角色

本站区分两种角色,能调用的接口范围不同:

| 角色            | 说明                     | 典型能力                                 |
| --------------- | ------------------------ | ---------------------------------------- |
| `internal_user` | 普通用户(如学生科研账号) | 查自己的 key/用量/花费明细               |
| `proxy_admin`   | 管理员                   | 额外可查全局报表、管理所有 key/用户/团队 |

> 本文档实测所用账号角色为 `internal_user`(访问组 `student-research`)。标注"管理员专属"的接口,普通用户调用会返回 `401`。

---

## 2. 快速开始:一句话查余量

```bash
curl -s "https://api.llm.ustc.edu.cn/key/info" \
  -H "Authorization: Bearer sk-xxxx" \
  | jq '.info | {max_budget, spend, remaining: (.max_budget - .spend), budget_duration, budget_reset_at}'
```

输出示例:

```json
{
  "max_budget": 100.0,
  "spend": 0.0,
  "remaining": 100.0,
  "budget_duration": "24h",
  "budget_reset_at": "2026-08-11T16:00:00+00:00"
}
```

- `max_budget` — 预算上限(元)
- `spend` — 当前已花费(元)
- `remaining = max_budget - spend` — 剩余可用额度
- `budget_reset_at` — 下次预算重置时间(UTC)

---

## 3. 接口总览

| 接口                                           | 方法     | 权限           | 作用                                                  |
| ---------------------------------------------- | -------- | -------------- | ----------------------------------------------------- |
| `/key/info`                                    | GET      | 普通用户       | **查单个 key 的预算 / 已花 / 余量** ⭐ 最常用         |
| `/user/info`                                   | GET      | 普通用户       | 查用户级累计花费 + 名下所有 key                       |
| `/key/list`                                    | GET      | 普通用户       | 列出可见 key 的哈希列表                               |
| `/spend/logs`                                  | GET      | 普通用户       | 逐条花费明细(每次调用的 model / tokens / 花费 / 耗时) |
| `/spend/logs/v2`                               | GET      | 普通用户       | 花费明细 v2(支持更多过滤、分页)                       |
| `/user/daily/activity`                         | GET      | 普通用户       | 每日用量(逐日)                                        |
| `/user/daily/activity/aggregated`              | GET      | **管理员专属** | 每日用量(聚合,普通用户 401)                           |
| `/global/spend/report`                         | GET      | **管理员专属** | 全局花费报表                                          |
| `/spend/tags`                                  | GET      | 管理员专属     | 按标签查看花费                                        |
| `/global/spend/tags`                           | GET      | 管理员专属     | 全局按标签花费                                        |
| `/global/spend/reset`                          | POST     | **管理员专属** | 重置全局花费                                          |
| `/provider/budgets`                            | GET      | 管理员专属     | 各 provider 预算                                      |
| `/key/generate` `/key/update` `/key/delete` 等 | POST     | **管理员专属** | 创建 / 修改 / 删除 key                                |
| `/team/*`                                      | GET/POST | 视情况         | 团队维度用量与管理                                    |
| `/health`                                      | GET      | 公开/任意      | 代理健康检查                                          |
| `/v1/models`                                   | GET      | 普通用户       | 可用模型列表                                          |
| `/key/health`                                  | POST     | 普通用户       | key 健康检查                                          |

> **普通用户实际能用的核心接口:** `/key/info`、`/user/info`、`/key/list`、`/spend/logs`、`/spend/logs/v2`、`/user/daily/activity`、`/user/daily/activity/aggregated`、`/v1/models`、`/health`。

---

## 4. 预算机制详解

本站的预算不是简单"总量固定",而是**多级滚动窗口**。以本次实测的 key 为例,`/key/info` 返回:

```json
{
  "max_budget": 100.0,
  "budget_duration": "24h",
  "budget_reset_at": "2026-08-11T16:00:00+00:00",
  "budget_limits": [
    { "reset_at": "2026-08-11T18:00:00+08:00", "max_budget": 30.0, "budget_duration": "3h" },
    { "reset_at": "2026-08-12T00:00:00+08:00", "max_budget": 70.0, "budget_duration": "12h" }
  ]
}
```

含义(该 key 共三层预算):

| 层级      | 窗口     | 上限       | 下次重置              |
| --------- | -------- | ---------- | --------------------- |
| 顶层      | 24h 滚动 | **100 元** | 每 24 小时重置        |
| 第 1 子限 | 3h       | 30 元      | 每天 18:00 (北京时间) |
| 第 2 子限 | 12h      | 70 元      | 每天 24:00 (北京时间) |

**三层同时生效,任一层用尽即停**(实际可用额度 = 各层剩余的最小值)。`budget_limits` 里是 `reset_at` 的绝对时刻 + 窗口时长,需自行计算"该层还剩下多少"。

**关键结论:**

- **余量不是无限大的总量,而是当前滚动窗口内的剩余。** 预算到点自动重置。
- 想判断"现在能不能继续用",看 `spend` 是否接近任一层的 `max_budget`,以及是否临近 `reset_at`。

---

## 5. 各接口详细说明

> 通用约定:
>
> - Base URL 为 `https://api.llm.ustc.edu.cn`
> - 全部需请求头 `Authorization: Bearer sk-xxxx`
> - 所有示例假定环境变量 `$KEY=sk-xxxx`

### 5.1 查 Key 余量 — `GET /key/info` ⭐

**用途:** 查询某个 API key 的预算、已花费、余量、限流、有效期等完整信息。**最核心的"查余量"接口。**

**请求参数:**

| 参数  | 位置  | 必填 | 说明                                                               |
| ----- | ----- | ---- | ------------------------------------------------------------------ |
| `key` | query | 否   | 要查询的 key。**不传时默认使用 Authorization 头里的 key 查询自身** |

**实测返回结构(`200`):**

```json
{
  "key": "317b9804...fb210ba",
  "info": {
    "key_name": "sk-...OOAQ",
    "key_alias": "PB25000124_74577946367",
    "spend": 0.0,
    "max_budget": 100.0,
    "budget_duration": "24h",
    "budget_reset_at": "2026-08-11T16:00:00+00:00",
    "budget_limits": [{ "reset_at": "...", "max_budget": 30.0, "budget_duration": "3h" }],
    "expires": "2053-11-04T05:46:42.997000+00:00",
    "blocked": false,
    "rpm_limit": 20,
    "max_parallel_requests": 20,
    "tpm_limit": null,
    "user_id": "81ce6947-...",
    "team_id": "a9339839-...",
    "models": [],
    "metadata": { "access_groups": ["student-research"], "is_vip": false, "authorized_models": ["qwen-chat", "..."] },
    "created_at": "...",
    "updated_at": "...",
    "last_active": "...",
    "created_by": "default_user_id",
    "model_spend": {},
    "model_max_budget": {},
    "rotation_count": 0,
    "auto_rotate": false
  }
}
```

**关键字段说明:**

| 字段                    | 类型     | 含义                                                  |
| ----------------------- | -------- | ----------------------------------------------------- |
| `spend`                 | float    | 当前窗口内已花费(元)                                  |
| `max_budget`            | float    | 预算上限(元);`null` = 无上限                          |
| `budget_duration`       | string   | 预算窗口,如 `"24h"`                                   |
| `budget_reset_at`       | datetime | 顶层预算下次重置时间(UTC)                             |
| `budget_limits`         | array    | 子层预算列表(见 [第 4 节](#4-预算机制详解))           |
| `expires`               | datetime | key 有效期截止                                        |
| `blocked`               | bool     | 是否被封禁                                            |
| `rpm_limit`             | int      | 每分钟请求数上限                                      |
| `tpm_limit`             | int      | 每分钟 token 数上限                                   |
| `max_parallel_requests` | int      | 最大并发请求数                                        |
| `models`                | array    | key 可用的模型白名单(空数组 = 用 metadata 或全局配置) |
| `user_id` / `team_id`   | string   | 归属用户 / 团队                                       |
| `last_active`           | datetime | 最近一次活跃时间                                      |

**计算余量的命令:**

```bash
curl -s "https://api.llm.ustc.edu.cn/key/info" -H "Authorization: Bearer $KEY" \
  | jq '.info | {key_alias, max_budget, spend, remaining: (.max_budget - .spend), budget_reset_at}'
```

---

### 5.2 查用户信息与名下所有 Key — `GET /user/info`

**用途:** 查看账号级累计花费、角色、所属团队,以及**该用户名下所有 key** 的预算/花费/有效期。

**请求参数:**

| 参数      | 位置  | 必填 | 说明                                           |
| --------- | ----- | ---- | ---------------------------------------------- |
| `user_id` | query | 否   | 要查询的用户 ID。不传时默认查当前 key 关联用户 |

**实测返回结构(`200`):**

```json
{
  "user_id": "81ce6947-...",
  "user_info": {
    "user_id": "81ce6947-...",
    "user_role": "internal_user",
    "user_alias": null,
    "spend": 1170.195728770001,
    "max_budget": null,
    "budget_duration": null,
    "teams": ["a9339839-..."],
    "user_email": null,
    "models": [],
    "created_at": "2026-06-16T07:02:05.639000Z",
    "updated_at": "2026-08-11T09:25:59.805000Z"
  },
  "keys": [
    {
      "token": "4b7085e2...ccde2",
      "key_name": "sk-...S2nQ",
      "key_alias": "PB25000124_30853777158",
      "spend": 0.0,
      "max_budget": 100.0,
      "budget_duration": "24h",
      "expires": "2053-11-04T05:46:03.506000+00:00",
      "rpm_limit": 20,
      "user_id": "81ce6947-...",
      "team_id": "a9339839-..."
    }
  ]
}
```

**关键字段说明:**

| 字段                   | 含义                                                                 |
| ---------------------- | -------------------------------------------------------------------- |
| `user_info.spend`      | **用户累计总花费**(历史累加,不随窗口重置)。本次实测为 **1170.20 元** |
| `user_info.max_budget` | 用户级预算上限(`null` = 无用户级限制,通常由各 key 各自限)            |
| `user_info.user_role`  | 角色(`internal_user` / `proxy_admin`)                                |
| `keys[]`               | 该用户名下的**所有 key 数组**,每个 key 含预算/花费/限流/有效期       |

> ⚠️ 注意区分:`/key/info` 里的 `spend` 是**当前窗口内**的花费;`/user/info` 里的 `user_info.spend` 是**历史累计**花费。前者用于判断当前余量,后者用于看总开销。
>
> 💡 上面的示例值是采集时刻的快照,`user_info.spend` 是**累计值,会随使用不断增长**——不必与附录 B 的数值一致,以实时返回为准。

---

### 5.3 列出可见 Key — `GET /key/list`

**用途:** 列出当前账号可见的 key 哈希列表(通常就是自己名下,含 `total_count` 分页信息)。

**请求参数(节选):**

| 参数                     | 说明                       |
| ------------------------ | -------------------------- |
| `page` / `size`          | 分页                       |
| `user_id` / `team_id`    | 按归属过滤                 |
| `return_full_object`     | 是否返回完整对象而非仅哈希 |
| `sort_by` / `sort_order` | 排序                       |

**实测返回(`200`):**

```json
{
  "keys": ["cfad36cd...638ac", "317b9804...fb210ba", "4b7085e2...ccde2"],
  "total_count": 3,
  "current_page": 1,
  "total_pages": 1
}
```

> 返回的是 key 的**哈希**(不是明文),要获取某 key 的完整信息需配合 `/key/info?key=<哈希>`。

---

### 5.4 花费明细 — `GET /spend/logs` / `GET /spend/logs/v2`

**用途:** 逐条查询每次模型调用的花费记录——哪个模型、多少 token、花了多少钱、耗时多久。

#### `/spend/logs`

**请求参数:**

| 参数                      | 说明                           |
| ------------------------- | ------------------------------ |
| `api_key`                 | 按 key 过滤(传 key 明文或哈希) |
| `user_id`                 | 按用户过滤                     |
| `request_id`              | 按单次请求过滤                 |
| `start_date` / `end_date` | 时间范围(YYYY-MM-DD)           |
| `summarize`               | 是否汇总                       |

> ⚠️ **实测注意:`/spend/logs` 的 `page` / `size` 参数无效**,传了 `size=1` 仍返回全部记录(实测 2167 条)。要限制范围请用 `start_date`/`end_date` 过滤,或用 `/spend/logs/v2`(v2 分页有效)。

**实测返回(`200`,数组):** 每条记录的字段:

```json
{
  "request_id": "chatcmpl-926a2ca6-...",
  "call_type": "acompletion",
  "api_key": "317b9804...fb210ba",
  "spend": 0.001626,
  "total_tokens": 1626,
  "prompt_tokens": 1530,
  "completion_tokens": 96,
  "startTime": "2026-08-10T01:49:56.573000Z",
  "endTime": "2026-08-10T01:50:09.166000Z",
  "request_duration_ms": 12592,
  "model": "openai/qwen36-27b",
  "model_id": "b45e6183-...",
  "model_group": "qwen3.6-chat",
  "custom_llm_provider": "openai",
  "api_base": "http://114.214.244.2:10024/qwen36/v1/",
  "user": "81ce6947-...",
  "metadata": {
    "status": null,
    "max_retries": 2,
    "usage_object": { "total_tokens": 1626, "prompt_tokens": 1530, "completion_tokens": 96 }
  }
}
```

**关键字段说明:**

| 字段                                                   | 含义                                       |
| ------------------------------------------------------ | ------------------------------------------ |
| `request_id`                                           | 请求唯一 ID(`chatcmpl-...`)                |
| `spend`                                                | 本次调用花费(元)                           |
| `total_tokens` / `prompt_tokens` / `completion_tokens` | token 用量                                 |
| `model_group`                                          | 模型组名(如 `qwen3.6-chat`),**日常看这个** |
| `model`                                                | 底层具体模型(如 `openai/qwen36-27b`)       |
| `api_base`                                             | 实际后端地址                               |
| `startTime` / `endTime` / `request_duration_ms`        | 时间与耗时                                 |
| `user`                                                 | 发起用户 ID                                |

#### `/spend/logs/v2`

同 `/spend/logs`,但**过滤/分页能力更强**(推荐用于批量查询):

| 参数                                             | 说明                              |
| ------------------------------------------------ | --------------------------------- |
| `page` / `page_size`                             | 分页(推荐组合使用,避免一次拉全量) |
| `api_key` / `user_id` / `request_id` / `team_id` | 归属过滤                          |
| `min_spend` / `max_spend`                        | 按花费区间过滤                    |
| `start_date` / `end_date`                        | 时间范围                          |
| `model` / `model_group` / `model_id`             | 按模型过滤                        |
| `status_filter` / `error_code` / `error_message` | 按状态/错误过滤                   |
| `key_alias` / `end_user`                         | 按别名/端用户过滤                 |
| `sort_by` / `sort_order`                         | 排序                              |

> ⚠️ **`/spend/logs/v2` 实测必须带 `start_date` 和 `end_date`**,否则返回 `400`:
> `{"error": {"message": "Start date and end date are required", "type": "bad_request", "code": "400"}}`
> 只传 `page`/`page_size` 不够。

**统计某 key 某段时间的总花费:**

```bash
curl -s "https://api.llm.ustc.edu.cn/spend/logs?api_key=$KEY&start_date=2026-08-01&end_date=2026-08-11" \
  -H "Authorization: Bearer $KEY" \
  | jq '[.[].spend] | add'
```

---

### 5.5 每日用量 — `GET /user/daily/activity`

**用途:** 按天查看用量(花费、token、成功/失败请求数),支持按模型、key、用户细分,做趋势分析。

**请求参数:**

| 参数                 | 必填   | 说明                              |
| -------------------- | ------ | --------------------------------- |
| `start_date`         | **是** | 起始日期 `YYYY-MM-DD`(不传会报错) |
| `end_date`           | **是** | 结束日期 `YYYY-MM-DD`             |
| `model`              | 否     | 按模型过滤                        |
| `api_key`            | 否     | 按 key 过滤                       |
| `user_id`            | 否     | 按用户过滤                        |
| `page` / `page_size` | 否     | 分页                              |
| `timezone`           | 否     | 时区                              |

**实测返回(`200`,结构):**

```json
{
  "results": [
    {
      "date": "2026-08-11",
      "metrics": {
        "spend": 341.8475463999999,
        "prompt_tokens": 241168879,
        "completion_tokens": 410689,
        "cache_read_input_tokens": 220942848,
        "cache_creation_input_tokens": 0,
        "total_tokens": 241579568,
        "successful_requests": 844,
        "failed_requests": 80,
        "api_requests": 924
      },
      "breakdown": {
        "mcp_servers": {},
        "models": {
          "openai/deepseek-v4-pro": {
            "metrics": { "...": "同顶层 metrics 结构" },
            "metadata": {},
            "api_key_breakdown": { "<api_key哈希>": { "metrics": "...", "spend": "..." } }
          }
        }
      }
    }
  ]
}
```

**关键字段说明:**

| 字段                                                                                                                       | 含义                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `results[]`                                                                                                                | 每天的记录数组,按 `date` 逐日排列                                                             |
| `date`                                                                                                                     | 日期(`YYYY-MM-DD`)                                                                            |
| `metrics.spend`                                                                                                            | 该日花费(元)                                                                                  |
| `metrics.prompt_tokens` / `completion_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens` / `total_tokens` | 各类 token 用量                                                                               |
| `metrics.successful_requests` / `failed_requests` / `api_requests`                                                         | 成功 / 失败 / 总请求数                                                                        |
| `breakdown.models`                                                                                                         | 按底层模型细分(键为模型名),每个模型含自己的 `metrics` 和 `api_key_breakdown`(按 key 哈希细分) |
| `breakdown.mcp_servers`                                                                                                    | MCP 服务器维度(通常为空)                                                                      |

**示例:某段时间每日花费曲线**

```bash
curl -s "https://api.llm.ustc.edu.cn/user/daily/activity?start_date=2026-08-01&end_date=2026-08-11" \
  -H "Authorization: Bearer $KEY" \
  | jq '.results[] | {date, spend: .metrics.spend, requests: .metrics.api_requests}'
```

> ⚠️ **必须带 `start_date` 和 `end_date`**,否则返回:`{"detail": {"error": "Please provide start_date and end_date"}}`
>
> 附注:接口 `/user/daily/activity/aggregated`(聚合版)在 OpenAPI 中存在,但实测**普通用户调用返回 `401`**,需 `proxy_admin` 角色。

---

### 5.6 全局花费报表(管理员)— `GET /global/spend/report`

**用途:** 按 api_key / 用户 / 团队 / 客户分组统计全局花费。

**请求参数:**

| 参数                                                       | 说明                                     |
| ---------------------------------------------------------- | ---------------------------------------- |
| `start_date` / `end_date`                                  | 时间范围                                 |
| `group_by`                                                 | 分组维度:`team` / `customer` / `api_key` |
| `api_key` / `internal_user_id` / `team_id` / `customer_id` | 过滤                                     |

**普通用户调用返回 `401`:**

```json
{
  "error": {
    "message": "Authentication Error, Only proxy admin can be used to generate, delete, update info for new keys/users/teams. Route=/global/spend/report. Your role=internal_user. Your user_id=81ce69****************************a8",
    "type": "auth_error",
    "param": "None",
    "code": "401"
  }
}
```

> 需要 `proxy_admin` 角色。普通用户查整体花费报表请用 `/user/info` 的 `user_info.spend`(累计)或 `/spend/logs`(明细)。

---

### 5.7 辅助接口

| 接口                                       | 方法 | 说明                                                         |
| ------------------------------------------ | ---- | ------------------------------------------------------------ |
| `/health`                                  | GET  | 代理健康检查                                                 |
| `/health/liveliness` / `/health/readiness` | GET  | 存活 / 就绪探针                                              |
| `/v1/models`                               | GET  | 当前可用模型列表(OpenAI 兼容格式,返回 `data[]` 数组,含 `id`) |
| `/key/health`                              | POST | key 健康检查                                                 |

`/v1/models` 示例:

```bash
curl -s "https://api.llm.ustc.edu.cn/v1/models" -H "Authorization: Bearer $KEY" \
  | jq '.data[].id'
```

---

## 6. 权限对照表

| 操作                                                               | `internal_user`(普通) | `proxy_admin`(管理员) |
| ------------------------------------------------------------------ | --------------------- | --------------------- |
| 查自己 key 的预算/余量 (`/key/info`)                               | ✅                    | ✅                    |
| 查名下所有 key (`/user/info`, `/key/list`)                         | ✅                    | ✅                    |
| 查自己 key 的花费明细 (`/spend/logs`, `/spend/logs/v2`)            | ✅                    | ✅                    |
| 查每日用量 (`/user/daily/activity`)                                | ✅                    | ✅                    |
| 每日用量聚合 (`/user/daily/activity/aggregated`)                   | ❌ 401                | ✅                    |
| 查可用模型 (`/v1/models`)                                          | ✅                    | ✅                    |
| key 健康检查 (`/key/health`)                                       | ✅                    | ✅                    |
| 全局花费报表 (`/global/spend/report`)                              | ❌ 401                | ✅                    |
| 全局按标签/重置 (`/global/spend/tags`, `/global/spend/reset`)      | ❌ 401                | ✅                    |
| 创建/删除/修改 key (`/key/generate`, `/key/update`, `/key/delete`) | ❌ 401                | ✅                    |
| 管理用户/团队 (`/user/new`, `/team/new`, `/team/member_add` 等)    | ❌ 401                | ✅                    |

---

## 7. 一键查询脚本

完整脚本保存在 `/tmp/ustc-usage-check.sh`。用法:

```bash
USTC_KEY=sk-xxxx bash /tmp/ustc-usage-check.sh
```

会依次输出:key 余量、用户累计花费与名下 key、本月每日用量、全局报表(预期 401)、最近花费明细、key 列表。

---

## 8. Web 控制台

浏览器打开 **`https://api.llm.ustc.edu.cn/ui`** —— LiteLLM Admin Panel:

- SSO 登录(页面也提供 Fallback Login)
- 图形化查看用量、花费曲线、key 管理
- 适合日常人工查看,不需要写脚本

---

## 9. 常见错误与排障

| 现象                                                              | 原因                                               | 解决                                                          |
| ----------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| `401` + `"Only proxy admin can be used..."`                       | 调用了管理员专属接口                               | 换用普通接口,或联系管理员                                     |
| `{"detail": {"error": "Please provide start_date and end_date"}}` | `/user/daily/activity` 缺日期                      | 加 `start_date` / `end_date` 参数                             |
| `422 Validation Error`                                            | 参数缺失或类型不对                                 | 核对 [openapi.json](https://api.llm.ustc.edu.cn/openapi.json) |
| `429`                                                             | 超过 `rpm_limit`(20/min)或 `max_parallel_requests` | 放慢请求频率                                                  |
| `spend` 接近 `max_budget` 被拒                                    | 预算用尽                                           | 等 `budget_reset_at` 重置,或联系管理员加额度                  |
| 查不到某 key 信息                                                 | key 哈希/别名不对,或不在可见范围                   | 用 `/key/list` 先确认哈希                                     |

---

## 10. 安全提示

- **API key 即凭证**,不要提交到 git、写入公开配置或截图分享。文档中的 key 仅为演示占位。
- 管理接口与模型接口共用同一认证,泄露 key 等于泄露全部用量数据。
- 日常查询建议用"只读"接口(`GET /key/info` 等),不要用脚本频繁轮询高权限接口。
- 查看 [LiteLLM 官方文档](https://docs.litellm.ai) 了解各字段的完整语义与版本差异。

---

## 附录 A:每日用量完整返回结构(已实测)

`GET /user/daily/activity?start_date=2026-08-01&end_date=2026-08-11`(200 OK)返回顶层对象 `{results: [...]}`:

```json
{
  "results": [
    {
      "date": "2026-08-11",
      "metrics": {
        "spend": 341.8475463999999,
        "prompt_tokens": 241168879,
        "completion_tokens": 410689,
        "cache_read_input_tokens": 220942848,
        "cache_creation_input_tokens": 0,
        "total_tokens": 241579568,
        "successful_requests": 844,
        "failed_requests": 80,
        "api_requests": 924
      },
      "breakdown": {
        "mcp_servers": {},
        "models": {
          "openai/deepseek-v4-pro": {
            "metrics": { "spend": "...", "total_tokens": "...", "api_requests": "..." },
            "metadata": {},
            "api_key_breakdown": {
              "<api_key哈希>": { "spend": "...", "metrics": "..." }
            }
          }
        }
      }
    }
  ]
}
```

- 无分页字段,一次返回日期范围内全部逐日记录。
- 聚合版 `/user/daily/activity/aggregated` 对普通用户返回 `401`。

## 附录 B:其他实测补充

### `/v1/models` — 可用模型列表(实测 20 个)

返回 `{"data": [{"id": "..."}, ...]}`,含:
`qwen3.5`, `qwen3.5-thinking`, `qwen-chat`, `qwen-reasoner`, `qwen3.6-chat`, `qwen3.6-reasoner`,
`claude-haiku-4-5`, `claude-sonnet-4-6`, `glm-chat`, `glm-reasoner`, `glm-5.2`,
`deepseek-v4-flash-ascend`, `deepseek-v4-flash-ascend1`, `deepseek-v4-pro`, `k3`,
`smart/default`, `smart/reasoning`, `unlimited-ocr` 等。

### `/key/health` — key 健康检查(实测 200)

```json
{ "key": "healthy", "logging_callbacks": null }
```

### `/user/info` 实测补充

实测账号 `total_spend = 1272.88 元`(历史累计,含所有 key)。名下 **3 个 key**:

| key                                             | max_budget       | spend      | 说明                            |
| ----------------------------------------------- | ---------------- | ---------- | ------------------------------- |
| `sk-...OOAQ`(本次文档用 key)                    | 100 (24h)        | 0.0        | 当前余量 100                    |
| `sk-...S2nQ`                                    | 100 (24h)        | 0.0        | 另一 key                        |
| `sk-...`(alias `107杯算力与智能体开发大赛_...`) | **null(无预算)** | **992.82** | 大赛专用 key,无上限、已花近千元 |

> 注意 `key_name` 字段返回的是脱敏形式(`sk-...OOAQ`),不是完整明文。`user_info.spend` 是累计值,会随使用不断增长(本次会话期间已从 1170 增至 1272)。

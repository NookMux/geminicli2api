# 2api 通用实现规范（语言无关版本）

> 本文档面向「想自己用任意语言实现一套 2api 服务」的人。  
> 只看这份文档，不依赖具体代码仓库，也可以从零实现一个 OpenAI 兼容、上游走 Google/Antigravity 的代理服务。

---

## 1. 目标与角色

### 1.1 2api 的作用

2api 本质上是一个「协议转换层」：

- 对外：暴露 **与 OpenAI 兼容** 的 HTTP API（如 `/v1/models`、`/v1/chat/completions`）。
- 对内：使用 **Google OAuth 获取的 token** 调用 Google/Antigravity 的内部生成接口。
- 负责：
  - 做好 OAuth 登录与 token 管理（多账号轮询、自动刷新）。
  - 把 **OpenAI 样式的请求** 转换为 **Antigravity 内部协议**。
  - 把 **Antigravity 响应** 转换回 **OpenAI 样式响应**。

调用方不需要知道你后面连的是谁，只需要当成一个“兼容 OpenAI 的服务”来用。

### 1.2 角色与数据流

涉及三个角色：

- 调用方 Client：任何会调用 OpenAI API 的 SDK 或自写 HTTP 客户端。
- 2api 服务：你要实现的进程/容器，对外是 OpenAI API，对内是 Antigravity。
- Google / Antigravity：真正执行大模型推理的后端，要求 Bearer token 授权。

数据流简化为：

1. 用户通过浏览器 / CLI 完成 Google OAuth 登录，2api 得到 `refresh_token`。
2. 2api 把账号信息持久化（例如 JSON 或数据库）。
3. 2api 提供 `/v1/chat/completions` 等接口给调用方用。
4. 每次有请求：
   - 从账号池选一个账号，必要时刷新 token。
   - 构造 Antigravity 所需的 JSON 请求体并发起 HTTP 调用。
   - 把返回内容转换成 OpenAI 格式再回给调用方。

---

## 2. Google OAuth 登录规范

这一部分定义 **2api 需要拿到什么类型的 Google 凭证**，以及怎样获取它们。
实现时你可以用任何 Web 框架 / CLI 库，只要行为符合这里的协议。

### 2.1 OAuth Client 配置

在 Google Cloud Console 中创建 OAuth 2.0 Client：

- 授权端点：`https://accounts.google.com/o/oauth2/v2/auth`
- Token 端点：`https://oauth2.googleapis.com/token`
- 授权类型：标准的 **Authorization Code + offline access**（需要 refresh_token）
- 建议 scope 列表（与现有实现一致）：

```text
https://www.googleapis.com/auth/cloud-platform
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/cclog
https://www.googleapis.com/auth/experimentsandconfigs
```

从控制台拿到：

- `client_id`
- `client_secret`

这两项在 2api 中分别记为：`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`。

### 2.2 授权 URL 参数规范

2api 构造的授权链接必须满足：

- 方法：GET
- URL：`https://accounts.google.com/o/oauth2/v2/auth`
- Query 参数：

```text
client_id      = <GOOGLE_CLIENT_ID>
redirect_uri   = <你的回调地址>
response_type  = code
scope          = <所有 scope 用空格拼接>
access_type    = offline
prompt         = consent
state          = <随机字符串，用来防 CSRF>
```

其中：

- `redirect_uri` 必须与 Google 控制台中配置的回调地址完全一致。
- `state` 要在服务端保存（内存或存储）用于后续校验。

### 2.3 授权完成后的回调处理

用户在浏览器中完成同意后，Google 会重定向到：

```text
<redirect_uri>?code=...&state=...&scope=...
```

2api 需要做的事情：

1. 解析 URL，拿到 `code` 与 `state`。
2. 校验 `state` 是否等于你当初生成并保存的值。
3. 计算最终的 `redirect_uri`：

   - 强烈建议不要依赖硬编码，而是用  
     `redirect_uri = origin + pathname`  
     例如回调 URL 是 `https://your-host/auth/oauth/callback?code=...`，  
     那么 `redirect_uri = https://your-host/auth/oauth/callback`。

后续的 token 交换必须用这个 **与授权请求完全一致的 redirect_uri**。

### 2.4 使用 code 换取 token

向 Token 端点发起 `application/x-www-form-urlencoded` 请求：

- 方法：POST
- URL：`https://oauth2.googleapis.com/token`
- 请求体（URL encoded）：

```text
code          = <回调中得到的 code>
client_id     = <GOOGLE_CLIENT_ID>
client_secret = <GOOGLE_CLIENT_SECRET>
redirect_uri  = <与授权时相同>
grant_type    = authorization_code
```

响应为 JSON，大致包含：

```json
{
  "access_token": "ya29....",
  "expires_in": 3599,
  "refresh_token": "1//0g....",
  "scope": " ... ",
  "token_type": "Bearer"
}
```

2api 至少需要持久化以下字段（字段名可以不同，但含义应一致）：

- `access_token`：调用 Antigravity 接口时用的 Bearer Token。
- `refresh_token`：用来刷新 access_token。
- `expires_in`：access_token 的有效期（秒）。
- `timestamp`：你写入这条记录时的时间戳（毫秒）。

你可以额外保存：

- `projectId`：一个你自己生成的、稳定的项目 ID（详见第 4 章）。
- `enable`：布尔值，标记账号是否被禁用。

形式随意（JSON 文件 / 数据库都可以），只要后面的 Token 管理逻辑能用到这些字段即可。

---

## 3. Token 管理规范（多账号轮询 + 自动刷新）

为了支持多个 Google 账号、自动刷新以及坏号剔除，建议实现一个「TokenManager」。

### 3.1 账号记录结构（示例）

逻辑上每个账号记录包含：

```json
{
  "access_token": "ya29....",
  "refresh_token": "1//0g....",
  "expires_in": 3599,
  "timestamp": 1710000000000,
  "projectId": "useful-wave-ab123",
  "enable": true
}
```

解释：

- `access_token` / `expires_in` / `timestamp` 用来判断是否过期。
- `refresh_token` 用来刷新 token。
- `projectId` 是发给 Antigravity 的 `project` 字段，**不要求与真实 GCP 项目 ID 一致**，只要稳定即可。
- `enable` 为 `false` 时表示该账号已被标记为不可用。

### 3.2 过期判断

定义函数 `isExpired(account)`：

```text
if 没有 timestamp 或 expires_in → 视为已过期

expires_at = timestamp + expires_in * 1000
if 当前时间 >= expires_at - 5 分钟 → 视为即将过期 → 需要刷新
```

### 3.3 刷新 access_token

当账号即将过期或已过期时，通过 refresh_token 刷新：

- 方法：POST
- URL：`https://oauth2.googleapis.com/token`
- Content-Type：`application/x-www-form-urlencoded`
- 请求体：

```text
client_id     = <GOOGLE_CLIENT_ID>
client_secret = <GOOGLE_CLIENT_SECRET>
grant_type    = refresh_token
refresh_token = <account.refresh_token>
```

成功响应：

```json
{
  "access_token": "新的 access token",
  "expires_in": 3599,
  "scope": "...",
  "token_type": "Bearer"
}
```

刷新后需要更新本地记录：

- `access_token` 更新为新的值。
- `expires_in` 更新为新的值。
- `timestamp` 更新为当前时间戳（毫秒）。

并写回存储（文件/数据库）。

### 3.4 坏号自动剔除

当调用 Antigravity 接口返回以下情况时，建议把账号标记为不可用：

- HTTP 状态码为 400 或 403 且错误信息表明权限或配额问题。

处理方式：

- 设置 `enable = false`，并在内存账号池中移除该账号。
- 日志提示：「账号 X 的 token 已失效或无权访问，已自动禁用」。

### 3.5 多账号轮询策略

简单但有效的策略：

- 把所有 `enable === true` 的账号加载为列表 `tokens[]`。
- 维护一个 `currentIndex`，初始为 0。
- 每次需要账号时：
  1. 从 `tokens[currentIndex]` 取账号。
  2. 如果过期，先刷新；刷新失败且状态为 400/403，则禁用并跳过。
  3. 如果成功获得可用 token，则把 `currentIndex` 自增，模 `tokens.length`。
  4. 全部账号尝试一圈都不可用时，返回「无可用 token」错误。

这样实现后，多账号会自动轮询，坏号会被剔除，整体服务尽量保持可用。

---

## 4. Antigravity / Gemini 内部请求协议

这一部分是 2api 的核心：**OpenAI 请求如何被转换为 Antigravity 请求**。

### 4.1 上游 API 端点

建议的默认值（可以通过配置覆盖）：

- 流式生成接口（SSE）：
  - `API_URL = https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse`
- 非流式生成接口：
  - `API_NO_STREAM_URL = https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent`
- 模型列表接口：
  - `API_MODELS_URL = https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels`

所有请求均为：

- 方法：`POST`
- Content-Type：`application/json`
- Authorization：`Bearer <account.access_token>`

### 4.2 通用请求头规范

给 Antigravity 发起请求时，应设置：

```text
Host: <配置中的 api.host>   # 如 daily-cloudcode-pa.sandbox.googleapis.com
User-Agent: <配置中的 userAgent>  # 如 antigravity/1.11.3 windows/amd64
Authorization: Bearer <access_token>
Content-Type: application/json
Accept-Encoding: gzip
```

是否需要代理、超时时间等由你自己实现控制。

### 4.3 请求体通用结构

**无论是否流式**，向生成接口发送的 JSON Body 统一为：

```json
{
  "project": "useful-wave-ab123",
  "requestId": "agent-xxxxx-uuid",
  "request": {
    "contents": [
      {
        "role": "user",
        "parts": [
          { "text": "你好" },
          { "inlineData": { "mimeType": "image/png", "data": "base64..." } }
        ]
      },
      {
        "role": "model",
        "parts": [
          {
            "functionCall": {
              "id": "call_xxx",
              "name": "search",
              "args": { "query": "{\"q\":\"xxx\"}" }
            }
          }
        ]
      },
      {
        "role": "user",
        "parts": [
          {
            "functionResponse": {
              "id": "call_xxx",
              "name": "search",
              "response": { "output": "{\"items\":[...]}"} 
            }
          }
        ]
      }
    ],
    "systemInstruction": {
      "role": "user",
      "parts": [
        {
          "text": "这里写你的系统提示词（system prompt）"
        }
      ]
    },
    "tools": [
      {
        "functionDeclarations": [
          {
            "name": "search",
            "description": "搜索功能描述",
            "parameters": {
              "type": "object",
              "properties": {
                "q": { "type": "string" }
              },
              "required": ["q"]
            }
          }
        ]
      }
    ],
    "toolConfig": {
      "functionCallingConfig": {
        "mode": "VALIDATED"
      }
    },
    "generationConfig": {
      "topP": 0.85,
      "topK": 50,
      "temperature": 1,
      "candidateCount": 1,
      "maxOutputTokens": 8096,
      "stopSequences": [
        "<|user|>",
        "<|bot|>",
        "<|context_request|>",
        "<|endoftext|>",
        "<|end_of_turn|>"
      ],
      "thinkingConfig": {
        "includeThoughts": true,
        "thinkingBudget": 1024
      }
    },
    "sessionId": "-123456789012345678"
  },
  "model": "rev19-uic3-1p",
  "userAgent": "antigravity"
}
```

关键点说明：

- `project`：任意但稳定的字符串，当前实现用「形容词 + 名词 + 随机后缀」。
- `requestId`：唯一请求 ID，建议用 `uuid` 加固定前缀。
- `contents`：会话历史（详见第 5 章的映射规则）。
- `systemInstruction`：系统级提示词，可从配置中读取。
- `tools` / `toolConfig`：函数调用能力，来自 OpenAI 工具定义转换。
- `generationConfig`：温度、topP/topK、最大输出等。
- `sessionId`：代表当前账号的会话 ID，可以是一个稳定的随机负数。
- `model`：真正发给 Antigravity 的模型名称，如果你支持 `xxx-thinking` 这样的后缀，可以在这里去掉后缀。
- `userAgent`：固定写 `antigravity` 或自定义。

---

## 5. OpenAI → Antigravity：请求映射规范

这里定义如何把 **OpenAI 的 chat.completions 请求** 转换为上面第 4 章中的 `contents` 等结构。

### 5.1 OpenAI 请求结构（简化版）

2api 需要支持的基本字段：

```json
{
  "model": "rev19-uic3-1p-thinking",
  "messages": [
    { "role": "system", "content": "你是一个助手" },
    { "role": "user", "content": "你好" },
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "这张图是什么？" },
        { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
      ]
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "search",
        "description": "搜索",
        "parameters": {
          "type": "object",
          "properties": { "q": { "type": "string" } },
          "required": ["q"],
          "$schema": "http://json-schema.org/draft-07/schema#"
        }
      }
    }
  ],
  "stream": true,
  "temperature": 1,
  "top_p": 0.85,
  "top_k": 50,
  "max_tokens": 8096
}
```

### 5.2 文本与图片内容映射

处理每条 `messages[i]` 时：

1. 如果 `role` 是 `user` 或 `system`：
   - 如果 `content` 是字符串：  
     - 生成一个 `contents` 元素：

       ```json
       {
         "role": "user",
         "parts": [{ "text": "原始文本内容" }]
       }
       ```

     - 如果你区分 system 与 user，可都统一映射为 `role: "user"`，当前实现就是这样。

   - 如果 `content` 是数组（多模态）：
     - 遍历数组：
       - `type === "text"` → 累积到一个字符串。
       - `type === "image_url"` 且 `image_url.url` 形如 `data:image/<format>;base64,<data>`：

         生成一个 `inlineData` part：

         ```json
         {
           "inlineData": {
             "mimeType": "image/<format>",
             "data": "<base64_data>"
           }
         }
         ```

     - 最终构造：

       ```json
       {
         "role": "user",
         "parts": [
           { "text": "所有 text 合并后的结果" },
           { "inlineData": {...} },
           { "inlineData": {...} }
         ]
       }
       ```

2. 其它 role 会在 5.3、5.4 中说明。

### 5.3 Assistant + tool_calls 映射（函数调用请求）

当 OpenAI 的 message 满足：

- `role === "assistant"`
- `message.tool_calls` 存在且非空

2api 需要把这些工具调用描述转换为 Antigravity 的 `functionCall`：

```json
{
  "role": "model",
  "parts": [
    {
      "functionCall": {
        "id": "call_xxx",
        "name": "search",
        "args": {
          "query": "{\"q\":\"关键字\"}"
        }
      }
    }
  ]
}
```

注意几点：

- Antigravity 里 `args` 是一个对象，这里当前实现里约定用 `args.query` 存放「原始的 JSON 字符串」，即：
  - `tool_call.function.arguments` 本身是一个 JSON 字符串。
  - 我们不在这里解析，而是把它放进 `args.query`。
- 如果连续有多次工具调用，可以把多个 `functionCall` part 塞进同一个 message 的 `parts` 里，也可以拆成多个 `contents` 元素，只要跟 5.4 对应得上即可。

### 5.4 Tool role 映射（函数调用结果）

当 OpenAI 的 message 满足：

- `role === "tool"`
- 存在 `tool_call_id` 与 `content`

需要把工具的结果封装回 Antigravity 的 `functionResponse`：

```json
{
  "role": "user",
  "parts": [
    {
      "functionResponse": {
        "id": "<tool_call_id>",
        "name": "<与之前 functionCall 同名>",
        "response": {
          "output": "<原始 content 文本>"
        }
      }
    }
  ]
}
```

这里的 `name` 需要通过回溯之前的 `functionCall` 找到同一个 `id` 对应的 `name`。

你可以做一些合并优化，例如：

- 如果上一条 message 的 `role === "user"` 且已经包含了 functionResponse，则把新的 functionResponse 追加进同一个 `parts`，避免生成太多 message。

### 5.5 OpenAI Tools → Antigravity Tools 映射

OpenAI 的 tools 定义：

```json
{
  "type": "function",
  "function": {
    "name": "search",
    "description": "搜索",
    "parameters": {
      "type": "object",
      "properties": {
        "q": { "type": "string" }
      },
      "required": ["q"],
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  }
}
```

转换为 Antigravity 格式：

```json
{
  "functionDeclarations": [
    {
      "name": "search",
      "description": "搜索",
      "parameters": {
        "type": "object",
        "properties": {
          "q": { "type": "string" }
        },
        "required": ["q"]
      }
    }
  ]
}
```

要点：

- 可以移除 `$schema` 字段，避免不必要的差异。
- 支持多个 tools 就生成多个 `functionDeclarations` 容器。

### 5.6 generationConfig 决策

根据 OpenAI 请求的参数填充：

- `temperature` ← `request.temperature` 或默认值。
- `topP` ← `request.top_p` 或默认值。
- `topK` ← `request.top_k` 或默认值。
- `maxOutputTokens` ← `request.max_tokens` 或默认值。
- `thinkingConfig`：
  - 如果模型名以 `-thinking` 结尾，或是特定模型（例如 `gemini-2.5-pro` 等），则：
    - `includeThoughts = true`
    - `thinkingBudget = 1024`
  - 否则：
    - `includeThoughts = false`
    - `thinkingBudget = 0`

你可以按自己需要调整这部分策略，只要保证前后行为一致即可。

---

## 6. Antigravity → OpenAI：响应映射规范

Antigravity 返回的响应结构大致如下（非流式）：

```json
{
  "response": {
    "candidates": [
      {
        "content": {
          "parts": [
            { "thought": true, "text": "模型内部思考过程..." },
            { "text": "展示给用户的内容..." },
            {
              "functionCall": {
                "id": "call_xxx",
                "name": "search",
                "args": { "query": "{\"q\":\"xxx\"}" }
              }
            },
            {
              "inlineData": {
                "mimeType": "image/png",
                "data": "base64..."
              }
            }
          ]
        },
        "finishReason": "STOP"
      }
    ]
  }
}
```

### 6.1 文本与思考内容（thought）处理

你需要遍历 `parts` 数组：

- `part.thought === true && part.text`：
  - 这是**模型内部思考**内容，按需处理：
    - 可以完全丢弃（对外隐藏思考过程）。
    - 或者像当前实现那样，包进 `<think>...</think>` 标记，在最终 content 里返回，方便调试。
- `part.text`（普通文本）：
  - 追加到最终 `content` 文本中。

当前实现的做法：

- 把所有 `thought === true` 的文本拼成一段 `thinkingContent`。
- 最后拼成：

```text
<think>
...thinkingContent...
</think>
...普通文本 content...
```

如果你不想暴露「思考过程」，可以简单把 thought 部分丢弃。

### 6.2 工具调用（functionCall）映射

当存在 `part.functionCall` 时，2api 需要转换为 OpenAI 的 `tool_calls`：

Antigravity：

```json
{
  "functionCall": {
    "id": "call_xxx",
    "name": "search",
    "args": { "query": "{\"q\":\"xxx\"}" }
  }
}
```

OpenAI 响应中的 tool_calls 元素：

```json
{
  "id": "call_xxx",
  "type": "function",
  "function": {
    "name": "search",
    "arguments": "{\"q\":\"xxx\"}"
  }
}
```

注意：

- 这里的 `arguments` 是一个字符串，即 JSON 编码。  
  当前实现从 `args.query` 中直接取出该字符串。

### 6.3 图片输出（inlineData）映射

如果 `parts` 中出现：

```json
{
  "inlineData": {
    "mimeType": "image/png",
    "data": "base64..."
  }
}
```

当前实现的做法：

1. 把 base64 图片写入磁盘，文件名随机。
2. 按配置生成可访问的 URL（如 `http://server:port/images/xxx.png`）。
3. 在最终 content 文本后追加 Markdown 图片：

```markdown
![image](http://server:port/images/xxx.png)
```

因此，非流式接口最终返回的 `content` 既包含文本，也包含 Markdown 图片引用。

你也可以选择别的表达方式（比如 OpenAI 新的 image 内容块），只要前后端约定一致。

### 6.4 流式 SSE 响应解析

当调用 `streamGenerateContent?alt=sse` 时，上游会发送形如：

```text
data: { ...JSON... }

data: { ...JSON... }

data: { "response": { "candidates":[...,"finishReason":"STOP"] } }

data: [DONE]
```

规范做法：

1. 把收到的字节流按 `\n` 划分为行。
2. 对于每一行：
   - 如果不以 `data: ` 开头，忽略。
   - 否则取出 `line.slice(6)`，尝试作为 JSON 解析（忽略解析失败）。
   - 解析成功后，照 6.1–6.3 的规则处理 `parts`。
3. 你可以维护一个本地 state：
   - `thinkingStarted`：是否已经开始输出 `<think>`。
   - `toolCalls[]`：累积 functionCall。
4. 当检测到 `finishReason` 且累计有 `toolCalls` 时，说明工具调用结束，可以在 OpenAI 的 SSE 流里发出一次：

```json
{
  "id": "...",
  "object": "chat.completion.chunk",
  "created": 1234567890,
  "model": "xxx",
  "choices": [
    {
      "index": 0,
      "delta": {
        "tool_calls": [ ... ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

其它普通文本内容则通过：

```json
{
  "delta": { "content": "增量文本" }
}
```

流式接口的完整行为，参照 OpenAI SSE 规范实现即可。

---

## 7. 2api 对外 HTTP API 规范（OpenAI 兼容）

只要你实现了下面这些接口，调用方就可以把 2api 当成 OpenAI 来用。

### 7.1 API Key 鉴权

建议实现一个简单的 API Key 机制：

- 在配置文件或环境变量中定义：`API_KEY = "sk-xxxx"`
- 对所有 `path` 以 `/v1/` 开头的请求，检查：
  - 请求头 `Authorization` 是否存在。
  - 如果是 `Bearer xxx`，取 `xxx`；否则直接取整个 header 值。
  - 与 `API_KEY` 不相等时，返回 `401 { "error": "Invalid API Key" }`。

这样所有客户端只需在请求头里带上：

```text
Authorization: Bearer sk-xxxx
```

即可访问你的 OpenAI 兼容接口。

### 7.2 GET /v1/models

- 方法：`GET`
- 路径：`/v1/models`
- 鉴权：需要正确的 API Key

行为：

1. 从 TokenManager 获取一个可用账号（会自动刷新 token）。
2. 向 `API_MODELS_URL` 发送请求，Body 可以是 `{}` 或空对象。
3. 上游返回类似：

```json
{ "models": { "rev19-uic3-1p": {...}, "xxx": {...} } }
```

4. 2api 需要返回 OpenAI 风格的模型列表：

```json
{
  "object": "list",
  "data": [
    {
      "id": "rev19-uic3-1p",
      "object": "model",
      "created": 1710000000,
      "owned_by": "google"
    }
  ]
}
```

`created` 可以用当前时间戳，`owned_by` 固定写 `"google"` 或其它标识。

### 7.3 POST /v1/chat/completions

- 方法：`POST`
- 路径：`/v1/chat/completions`
- Content-Type：`application/json`
- 鉴权：需要正确的 API Key

请求体结构参见 5.1，2api 需要至少支持：

- `model`：字符串，转为 Antigravity 的 `model` 字段。
- `messages`：OpenAI 聊天消息数组。
- `stream`：布尔值，控制是否使用 SSE 流式。
- `tools`：函数调用定义。
- `temperature` / `top_p` / `top_k` / `max_tokens` 等采样参数。

行为：

1. 校验 `messages` 是否存在，否则返回 `400 { "error": "messages is required" }`。
2. 从 TokenManager 取一个可用 token，没有则返回错误：
   - 比如 `500 { "error": "没有可用的 token，请先完成 OAuth 登录" }`。
3. 用第 5 章定义的规则，把 OpenAI 请求转换为 Antigravity 请求 JSON。
4. 根据 `stream`：
   - `true` → 调用 `API_URL`（SSE 流式），解析并按 OpenAI chunk 格式逐块返回。
   - `false` → 调用 `API_NO_STREAM_URL`，解析后一次性返回完整结果。

响应示例（非流式）：

```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "rev19-uic3-1p",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "你好，我是 2api 代理出来的大模型。",
        "tool_calls": [
          {
            "id": "call_xxx",
            "type": "function",
            "function": {
              "name": "search",
              "arguments": "{\"q\":\"xxx\"}"
            }
          }
        ]
      },
      "finish_reason": "stop"
    }
  ]
}
```

错误情况：

- 上游返回非 200：
  - 把 HTTP 状态码和错误内容记录日志。
  - 对调用方返回 500 或合适的错误，并带上部分错误信息（避免全部透出内部细节）。
- 如果因 400/403 禁用了某账号，继续尝试下一个账号。

---

## 8. 实现 2api 的推荐步骤（任何语言都适用）

如果你要用 Go / Rust / Java / Python / C# 自己写一个 2api，可以按这个顺序来：

1. 实现一个简单的 HTTP 服务框架（如监听 `:8045`）。
2. 实现一个配置模块：
   - 加载 `API_URL` / `API_NO_STREAM_URL` / `API_MODELS_URL` / `API_KEY` / `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 等。
3. 实现 Google OAuth 登录流程：
   - 能输出授权链接。
   - 能接收回调 URL，把 `code` 换成 access/refresh token。
   - 能把账号信息持久化存储。
4. 实现 TokenManager：
   - 按 3 章的规则轮询 + 刷新 + 禁用坏号。
5. 实现 OpenAI → Antigravity 请求映射：
   - 支持纯文本、图片（data URL）、工具调用三种情况。
6. 实现 Antigravity → OpenAI 响应映射：
   - 支持非流式。
   - 再实现 SSE 流式解析与增量响应。
7. 对外暴露：
   - `GET /v1/models`
   - `POST /v1/chat/completions`
   - 可选：健康检查 `/healthz` 等。
8. 写几个集成测试：
   - 用 curl / Postman 或其他语言的 OpenAI SDK 连你的 2api，看模型能否正常对话、函数调用、图片生成。

做到这里，你就有一个真正语言无关、可自部署的 2api 实现了。

---

如果你希望，我也可以帮你把这份协议再精简出一个「一页纸架构图 + 时序图」版本，用来在 PPT 或 README 顶部给人快速解释 2api 是什么，要不要顺手搞一版？***

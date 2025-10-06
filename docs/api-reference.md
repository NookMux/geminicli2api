# API 接口文档

## 概述

本服务提供两套完整的 API 端点：OpenAI 兼容端点和 Gemini 原生端点，均支持相同的认证方式。

## OpenAI 兼容端点

### 聊天完成端点

**端点：** `/v1/chat/completions`
**方法：** POST
**认证：** `Authorization: Bearer your_api_password`

#### 请求格式
支持标准 OpenAI 格式（messages 结构）和 Gemini 原生格式（contents 结构），系统会自动检测。

**OpenAI 格式示例**：
```json
{
  "model": "gemini-2.5-pro",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello, how are you?"}
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 1000
}
```

**Gemini 格式示例**：
```json
{
  "contents": [
    {"role": "user", "parts": [{"text": "Hello, how are you?"}]}
  ],
  "generationConfig": {
    "temperature": 0.7,
    "maxOutputTokens": 1000
  }
}
```

#### 特殊功能
- **多模态输入支持**：文本 + 图像（base64编码）
- **真正的实时流式响应**：Server-Sent Events 流式传输
- **思维链内容自动分离**：自动分离思考过程和最终回答
- **流式抗截断功能**：自动检测和重试被截断的响应

**多模态输入示例**：
```json
{
  "model": "gemini-2.5-pro",
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "What do you see in this image?"},
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
          }
        }
      ]
    }
  ]
}
```

### 模型列表端点

**端点：** `/v1/models`
**方法：** GET
**认证：** `Authorization: Bearer your_api_password`

返回可用的模型列表。

## Gemini 原生端点

### 非流式生成端点

**端点：** `/v1/models/{model}:generateContent`
**方法：** POST
**认证：** 支持多种认证方式

### 流式生成端点

**端点：** `/v1/models/{model}:streamGenerateContent`
**方法：** POST
**认证：** 支持多种认证方式

### Token 计数端点

**端点：** `/v1/models/{model}:countTokens`
**方法：** POST
**认证：** 支持多种认证方式

### 模型列表端点

**端点：** `/v1/models`
**方法：** GET
**认证：** 支持多种认证方式

### 单个模型信息端点

**端点：** `/v1/models/{model}`
**方法：** GET
**认证：** 支持多种认证方式

## 认证方式

Gemini 原生端点支持以下认证方式（任选一种）：

- `Authorization: Bearer your_api_password`
- `x-goog-api-key: your_api_password`
- URL 参数：`?key=your_api_password`

## 支持的模型

### 基础模型
- `gemini-2.5-pro`
- `gemini-2.5-pro-preview-06-05`
- `gemini-2.5-pro-preview-05-06`

### 思维模型（Thinking Models）
- `gemini-2.5-pro-maxthinking`：最大思考预算模式
- `gemini-2.5-pro-nothinking`：无思考模式

### 搜索增强模型
- `gemini-2.5-pro-search`：集成搜索功能的模型

### 特殊功能变体

#### 假流式模式
在任何模型名称后添加 `-假流式` 后缀：
- 例：`gemini-2.5-pro-假流式`
- 用于需要流式响应但服务端不支持真流式的场景

#### 流式抗截断模式
在模型名称前添加 `流式抗截断/` 前缀：
- 例：`流式抗截断/gemini-2.5-pro`
- 自动检测响应截断并重试，确保完整回答

## 响应格式

### OpenAI 端点响应格式

**非流式响应示例**：
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "gemini-2.5-pro",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! I'm doing well, thank you for asking. How can I assist you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 15,
    "total_tokens": 25
  }
}
```

**流式响应示例**：
```
data: {"id": "chatcmpl-abc123", "object": "chat.completion.chunk", "created": 1677652288, "model": "gemini-2.5-pro", "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": null}]}

data: {"id": "chatcmpl-abc123", "object": "chat.completion.chunk", "created": 1677652288, "model": "gemini-2.5-pro", "choices": [{"index": 0, "delta": {"content": "Hello!"}, "finish_reason": null}]}

data: {"id": "chatcmpl-abc123", "object": "chat.completion.chunk", "created": 1677652288, "model": "gemini-2.5-pro", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}

data: [DONE]
```

**思维模型响应示例**：
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "gemini-2.5-pro-maxthinking",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The final answer is...",
        "reasoning_content": "Let me think through this step by step..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 150,
    "total_tokens": 160
  }
}
```

### 错误响应格式

```json
{
  "error": {
    "message": "Invalid authentication credentials",
    "type": "invalid_request_error",
    "param": null,
    "code": "invalid_api_key"
  }
}
```

**常见错误代码**：
- `invalid_api_key`: API 密码无效
- `rate_limit_exceeded`: 请求频率超限
- `insufficient_quota`: 凭证配额不足
- `model_not_found`: 指定的模型不存在
- `invalid_request`: 请求格式错误

## Web 控制台 API

### 认证端点
- `POST /auth/login` - 用户登录
- `POST /auth/start` - 开始 OAuth 认证
- `POST /auth/callback` - 处理 OAuth 回调
- `GET /auth/status/{project_id}` - 检查认证状态

### 凭证管理端点
- `GET /creds/status` - 获取所有凭证状态
- `POST /creds/action` - 单个凭证操作（启用/禁用/删除）
- `POST /creds/batch-action` - 批量凭证操作
- `POST /auth/upload` - 批量上传凭证文件（支持 ZIP）
- `GET /creds/download/{filename}` - 下载凭证文件
- `GET /creds/download-all` - 打包下载所有凭证
- `POST /creds/fetch-email/{filename}` - 获取用户邮箱
- `POST /creds/refresh-all-emails` - 批量刷新用户邮箱

### 配置管理端点
- `GET /config/get` - 获取当前配置
- `POST /config/save` - 保存配置

### 环境变量凭证端点
- `POST /auth/load-env-creds` - 加载环境变量凭证
- `DELETE /auth/env-creds` - 清除环境变量凭证
- `GET /auth/env-creds-status` - 获取环境变量凭证状态

### 日志管理端点
- `POST /auth/logs/clear` - 清空日志
- `GET /auth/logs/download` - 下载日志文件
- `WebSocket /auth/logs/stream` - 实时日志流

### 使用统计端点
- `GET /usage/stats` - 获取使用统计
- `GET /usage/aggregated` - 获取聚合统计
- `POST /usage/update-limits` - 更新使用限制
- `POST /usage/reset` - 重置使用统计
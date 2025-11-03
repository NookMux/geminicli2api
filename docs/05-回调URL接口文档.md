# 回调URL API 接口文档

## 概述

本模块提供了两个简单的API接口用于OAuth授权流程，支持通过环境变量配置的API密钥进行身份验证。

## 环境变量配置

在使用接口之前，需要设置以下环境变量：

```bash
# 设置回调API密钥（必需）
export CALLBACK_API_KEY="your_secret_api_key_here"
```

## API 接口

### 1. 获取授权URL

**接口地址：** `GET /auth/callback-url`

**功能：** 获取Google OAuth授权URL

**请求头：**
```
X-API-Key: your_secret_api_key_here
```

**或者通过查询参数：**
```
GET /auth/callback-url?api_key=your_secret_api_key_here
```

**成功响应 (200)：**
```json
{
    "code": 200,
    "msg": "成功",
    "url": "https://accounts.google.com/oauth/authorize?..."
}
```

**错误响应：**

- API密钥未配置 (403)：
```json
{
    "code": 403,
    "msg": "API密钥未配置"
}
```

- 密钥验证失败 (403)：
```json
{
    "code": 403,
    "msg": "密钥未通过校验"
}
```

- 服务器错误 (500)：
```json
{
    "code": 500,
    "msg": "服务器错误: 具体错误信息"
}
```

### 2. 设置回调URL并完成OAuth认证

**接口地址：** `POST /auth/callback-url`

**功能：** 验证回调URL并完成OAuth认证流程

**请求头：**
```
Content-Type: application/json
X-API-Key: your_secret_api_key_here
```

**或者通过查询参数：**
```
POST /auth/callback-url?api_key=your_secret_api_key_here
```

**请求体：**
```json
{
    "url": "https://example.com/oauth/callback?code=...&state=...",
    "id": "optional_project_id"
}
```

**参数说明：**
- `url` (必需): OAuth回调URL，包含授权码和状态参数
- `id` (可选): 项目ID，用于指定特定的项目

**成功响应 (200)：**
```json
{
    "code": 200,
    "msg": "回调URL设置成功并已完成OAuth认证"
}
```

**错误响应：**

- API密钥未配置 (403)：
```json
{
    "code": 403,
    "msg": "API密钥未配置"
}
```

- 密钥验证失败 (403)：
```json
{
    "code": 403,
    "msg": "密钥未通过校验"
}
```

- 回调URL格式错误 (401)：
```json
{
    "code": 401,
    "msg": "回调URL格式错误"
}
```

- 不支持的协议 (401)：
```json
{
    "code": 401,
    "msg": "回调URL必须是HTTP或HTTPS协议"
}
```

- ID字段类型错误 (401)：
```json
{
    "code": 401,
    "msg": "ID字段必须是字符串类型"
}
```

- 回调URL处理失败 (401)：
```json
{
    "code": 401,
    "msg": "具体错误信息"
}
```

- 服务器错误 (500)：
```json
{
    "code": 500,
    "msg": "服务器错误: 具体错误信息"
}
```

## 使用示例

### 1. 使用curl获取授权URL

```bash
# 通过请求头传递API密钥
curl -H "X-API-Key: your_secret_api_key_here" \
     http://localhost:7861/auth/callback-url

# 或者通过查询参数传递API密钥
curl "http://localhost:7861/auth/callback-url?api_key=your_secret_api_key_here"
```

### 2. 使用curl设置回调URL

```bash
curl -X POST \
     -H "Content-Type: application/json" \
     -H "X-API-Key: your_secret_api_key_here" \
     -d '{
       "url": "https://your-domain.com/callback?code=auth_code_here&state=state_here",
       "id": "optional_project_id"
     }' \
     http://localhost:7861/auth/callback-url
```

### 3. 使用Python示例

```python
import requests
import json

# 配置
base_url = "http://localhost:7861"
api_key = "your_secret_api_key_here"
headers = {
    "X-API-Key": api_key,
    "Content-Type": "application/json"
}

# 1. 获取授权URL
response = requests.get(f"{base_url}/auth/callback-url", headers=headers)
if response.json().get("code") == 200:
    auth_url = response.json()["url"]
    print(f"请访问此URL完成授权: {auth_url}")

    # 用户完成授权后，会获得回调URL

    # 2. 设置回调URL（假设这是从回调获得的URL）
    callback_data = {
        "url": "https://your-domain.com/callback?code=received_code&state=received_state",
        "id": "my_project_id"
    }

    response = requests.post(
        f"{base_url}/auth/callback-url",
        headers=headers,
        data=json.dumps(callback_data)
    )

    print(response.json())
```

## 安全注意事项

1. **API密钥保护**: 请妥善保管`CALLBACK_API_KEY`，不要在代码中硬编码或提交到版本控制系统
2. **HTTPS使用**: 在生产环境中，建议使用HTTPS协议来保护API密钥的传输
3. **URL验证**: 系统会验证回调URL的格式，只允许HTTP和HTTPS协议
4. **日志记录**: 所有的API调用和错误都会记录在系统日志中，便于调试和审计

## 错误代码说明

| 错误代码 | 说明 |
|---------|------|
| 200 | 成功 |
| 401 | 回调URL格式错误或处理失败 |
| 403 | API密钥未配置或验证失败 |
| 500 | 服务器内部错误 |

## 集成说明

这两个接口已经集成到现有的`src/web_routes.py`模块中，会随着应用启动自动提供服务。接口复用了现有的OAuth认证系统，确保与现有功能的兼容性。

接口使用了FastAPI的依赖注入系统，支持异步处理，能够高效地处理并发请求。
# Antigravity to OpenAI API 代理服务

将 Google Antigravity API 转换为 OpenAI 兼容格式的代理服务，支持流式响应、工具调用和多账号管理。

## 功能特性

- ✅ OpenAI API 兼容格式
- ✅ 流式和非流式响应
- ✅ 工具调用（Function Calling）支持
- ✅ 多账号自动轮换
- ✅ Token 自动刷新
- ✅ API Key 认证
- ✅ 思维链（Thinking）输出
- ✅ 图片输入支持（Base64 编码）

## 环境要求

- Node.js >= 18.0.0

## 快速开始

### 方式一：Docker 部署（推荐）

#### 1. 使用 Docker Compose

```bash
# 克隆项目
git clone https://github.com/your-username/antigravity2api-nodejs.git
cd antigravity2api-nodejs

# 复制环境变量配置
cp .env.example .env

# 编辑配置文件（可选）
nano .env

# 启动服务
docker-compose up -d
```

#### 2. 使用 Docker Hub

```bash
# 拉取镜像
docker pull ghcr.io/your-username/antigravity2api-nodejs:latest

# 创建数据目录
mkdir -p ./data

# 运行容器
docker run -d \
  --name antigravity-api \
  -p 8045:8045 \
  -v $(pwd)/data:/app/data \
  -e API_KEY=sk-text \
  --restart unless-stopped \
  ghcr.io/your-username/antigravity2api-nodejs:latest
```

#### 3. 配置环境变量

Docker 部署时支持以下环境变量配置：

```bash
# 基础配置
-e PORT=8045
-e HOST=0.0.0.0
-e API_KEY=sk-text

# 代理配置（如需要）
-e PROXY=http://host.docker.internal:7897

# 系统提示词
-e SYSTEM_INSTRUCTION="你是聊天机器人..."
```

### 方式二：本地安装

#### 1. 安装依赖

```bash
npm install
```

#### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并编辑配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件配置服务器和 API 参数：

```env
PORT=8045
HOST=0.0.0.0
API_KEY=sk-text
```

#### 3. 登录获取 Token

```bash
npm run login
```

浏览器会自动打开 Google 授权页面，授权后 Token 会保存到 `data/accounts.json`。

#### 4. 启动服务

```bash
npm start
```

服务将在 `http://localhost:8045` 启动。

## API 使用

### 获取模型列表

```bash
curl http://localhost:8045/v1/models \
  -H "Authorization: Bearer sk-text"
```

### 聊天补全（流式）

```bash
curl http://localhost:8045/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-text" \
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'
```

### 聊天补全（非流式）

```bash
curl http://localhost:8045/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-text" \
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
  }'
```

### 工具调用示例

```bash
curl http://localhost:8045/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-text" \
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [{"role": "user", "content": "北京天气怎么样"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "获取天气信息",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string", "description": "城市名称"}
          }
        }
      }
    }]
  }'
```

### 图片输入示例

支持 Base64 编码的图片输入，兼容 OpenAI 的多模态格式：

```bash
curl http://localhost:8045/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-text" \
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "这张图片里有什么？"},
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
          }
        }
      ]
    }],
    "stream": true
  }'
```

支持的图片格式：
- JPEG/JPG (`data:image/jpeg;base64,...`)
- PNG (`data:image/png;base64,...`)
- GIF (`data:image/gif;base64,...`)
- WebP (`data:image/webp;base64,...`)

## 多账号管理

`data/accounts.json` 支持多个账号，服务会自动轮换使用：

```json
[
  {
    "access_token": "ya29.xxx",
    "refresh_token": "1//xxx",
    "expires_in": 3599,
    "timestamp": 1234567890000,
    "enable": true
  },
  {
    "access_token": "ya29.yyy",
    "refresh_token": "1//yyy",
    "expires_in": 3599,
    "timestamp": 1234567890000,
    "enable": true
  }
]
```

- `enable: false` 可禁用某个账号
- Token 过期会自动刷新
- 刷新失败（403）会自动禁用并切换下一个账号

## 配置说明

### 环境变量 (.env)

| 环境变量 | 说明 | 默认值 |
|--------|------|--------|
| `PORT` | 服务端口 | 8045 |
| `HOST` | 监听地址 | 127.0.0.1 |
| `API_KEY` | API 认证密钥 | - |
| `MAX_REQUEST_SIZE` | 最大请求体大小 | 50mb |
| `DEFAULT_TEMPERATURE` | 默认温度参数 | 1 |
| `DEFAULT_TOP_P` | 默认 top_p | 0.85 |
| `DEFAULT_TOP_K` | 默认 top_k | 50 |
| `DEFAULT_MAX_TOKENS` | 默认最大 token 数 | 8096 |
| `USE_NATIVE_FETCH` | 使用原生 axios | false |
| `TIMEOUT` | 请求超时时间（毫秒） | 30000 |
| `PROXY` | 代理地址 | - |
| `SYSTEM_INSTRUCTION` | 系统提示词 | - |

完整配置示例请参考 `.env.example` 文件。

## Docker 部署详细说明

### 自动构建和部署

项目配置了 GitHub Actions 自动构建流程：

1. **触发条件**：推送到 `main/master` 分支或手动触发
2. **构建平台**：支持 `linux/amd64` 和 `linux/arm64` 架构
3. **镜像仓库**：GitHub Container Registry (`ghcr.io`)
4. **标签策略**：
   - `latest`: 主分支最新版本
   - `main-{commit}`: 主分支特定提交
   - `pr-{commit}`: Pull Request 版本

### 数据持久化

Docker 部署时，重要数据会映射到容器外部：

- `./data:/app/data`: 存储 `accounts.json` 和生成的图片
- 环境变量配置：通过 `-e` 参数或环境文件传入

### 生产环境部署

对于生产环境，建议使用以下配置：

```yaml
version: '3.8'
services:
  antigravity-api:
    image: ghcr.io/your-username/antigravity2api-nodejs:latest
    container_name: antigravity-api-prod
    restart: always
    ports:
      - "8045:8045"
    environment:
      - API_KEY=your-secure-api-key
      - PROXY=http://your-proxy:port
      - MAX_REQUEST_SIZE=100mb
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

## 开发命令

```bash
# 启动服务
npm start

# 开发模式（自动重启）
npm run dev

# 登录获取 Token
npm run login
```

## 项目结构

```
.
├── data/
│   └── accounts.json       # Token 存储（自动生成）
├── scripts/
│   ├── oauth-server.js     # OAuth 登录服务
│   └── refresh-tokens.js   # Token 刷新脚本
├── src/
│   ├── api/
│   │   └── client.js       # API 调用逻辑
│   ├── auth/
│   │   └── token_manager.js # Token 管理
│   ├── bin/
│   │   ├── antigravity_requester_android_arm64   # Android ARM64 TLS 请求器
│   │   ├── antigravity_requester_linux_amd64     # Linux AMD64 TLS 请求器
│   │   └── antigravity_requester_windows_amd64.exe # Windows AMD64 TLS 请求器
│   ├── config/
│   │   └── config.js       # 配置加载
│   ├── server/
│   │   └── index.js        # 主服务器
│   ├── utils/
│   │   ├── idGenerator.js  # ID 生成器
│   │   ├── logger.js       # 日志模块
│   │   └── utils.js        # 工具函数
│   └── AntigravityRequester.js # TLS 指纹请求器封装
├── test/
│   ├── test-request.js     # 请求测试
│   └── test-transform.js   # 转换测试
├── .github/
│   └── workflows/
│       └── docker.yml      # GitHub Actions 工作流
├── .env                    # 环境变量配置
├── .env.example            # 环境变量配置示例
├── Dockerfile              # Docker 镜像构建文件
├── docker-compose.yml      # Docker Compose 配置
└── package.json            # 项目配置
```

## 注意事项

1. 首次使用需要复制 `.env.example` 为 `.env` 并配置
2. 运行 `npm run login` 获取 Token
3. `.env` 和 `data/accounts.json` 包含敏感信息，请勿泄露
4. 支持多账号轮换，提高可用性
5. Token 会自动刷新，无需手动维护

## License

MIT

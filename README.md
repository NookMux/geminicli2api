# GeminiCLI to API

**将 GeminiCLI 转换为 OpenAI 和 GEMINI API 接口**

## 核心功能

### 🔄 API 端点和格式支持

**多端点双格式支持**
- **OpenAI 兼容端点**：`/v1/chat/completions` 和 `/v1/models`
  - 支持标准 OpenAI 格式（messages 结构）
  - 支持 Gemini 原生格式（contents 结构）
  - 自动格式检测和转换，无需手动切换
  - 支持多模态输入（文本 + 图像）
- **Gemini 原生端点**：`/v1/models/{model}:generateContent` 和 `streamGenerateContent`
  - 支持完整的 Gemini 原生 API 规范
  - 多种认证方式：Bearer Token、x-goog-api-key 头部、URL 参数 key

### 🔐 认证和安全管理

**灵活的密码管理**
- **分离密码支持**：API 密码（聊天端点）和控制面板密码可独立设置
- **多种认证方式**：支持 Authorization Bearer、x-goog-api-key 头部、URL 参数等
- **JWT Token 认证**：控制面板支持 JWT 令牌认证
- **用户邮箱获取**：自动获取和显示 Google 账户邮箱地址

### 📊 智能凭证管理系统

**高级凭证管理**
- 多个 Google OAuth 凭证自动轮换
- 通过冗余认证增强稳定性
- 负载均衡与并发请求支持
- 自动故障检测和凭证禁用
- 凭证使用统计和配额管理
- 支持手动启用/禁用凭证文件
- 批量凭证文件操作（启用、禁用、删除）

**凭证状态监控**
- 实时凭证健康检查
- 错误码追踪（429、403、500 等）
- 自动封禁机制（可配置）
- 凭证轮换策略（基于调用次数）
- 使用统计和配额监控

### 🌊 流式传输和响应处理

**多种流式支持**
- 真正的实时流式响应
- 假流式模式（用于兼容性）
- 流式抗截断功能（防止回答被截断）
- 异步任务管理和超时处理

**响应优化**
- 思维链（Thinking）内容分离
- 推理过程（reasoning_content）处理
- 多轮对话上下文管理
- 兼容性模式（将 system 消息转换为 user 消息）

### 🎛️ Web 管理控制台

**全功能 Web 界面**
- OAuth 认证流程管理
- 凭证文件上传、下载、管理
- 实时日志查看（WebSocket）
- 系统配置管理
- 使用统计和监控面板
- 移动端适配界面

**批量操作支持**
- ZIP 文件批量上传凭证
- 批量启用/禁用/删除凭证
- 批量获取用户邮箱
- 批量配置管理

### 📈 使用统计和监控

**详细使用统计**
- 按凭证文件统计调用次数
- Gemini 2.5 Pro 模型专项统计
- 每日配额管理（UTC+7 重置）
- 聚合统计和分析
- 自定义每日限制配置

**实时监控**
- WebSocket 实时日志流
- 系统状态监控
- 凭证健康状态
- API 调用成功率统计

### 🔧 高级配置和自定义

**网络和代理配置**
- HTTP/HTTPS 代理支持
- 代理端点配置（OAuth、Google APIs、元数据服务）
- 超时和重试配置
- 网络错误处理和恢复

**性能和稳定性配置**
- 429 错误自动重试（可配置间隔和次数）
- 抗截断最大重试次数
- 凭证轮换策略
- 并发请求管理

**日志和调试**
- 多级日志系统（DEBUG、INFO、WARNING、ERROR）
- 日志文件管理
- 实时日志流
- 日志下载和清空

### 🔄 环境变量和配置管理

**灵活的配置方式**
- TOML 配置文件支持
- 环境变量配置
- 热配置更新（部分配置项）
- 配置锁定（环境变量优先级）

**环境变量凭证支持**
- `GCLI_CREDS_*` 格式环境变量导入
- 自动加载环境变量凭证
- Base64 编码凭证支持
- Docker 容器友好

## 支持的模型

所有模型均具备 1M 上下文窗口容量。每个凭证文件提供 1000 次请求额度。

### 🤖 基础模型
- `gemini-2.5-pro`
- `gemini-2.5-pro-preview-06-05`  
- `gemini-2.5-pro-preview-05-06`

### 🧠 思维模型（Thinking Models）
- `gemini-2.5-pro-maxthinking`：最大思考预算模式
- `gemini-2.5-pro-nothinking`：无思考模式
- 支持自定义思考预算配置
- 自动分离思维内容和最终回答

### 🔍 搜索增强模型
- `gemini-2.5-pro-search`：集成搜索功能的模型

### 🌊 特殊功能变体
- **假流式模式**：在任何模型名称后添加 `-假流式` 后缀
  - 例：`gemini-2.5-pro-假流式`
  - 用于需要流式响应但服务端不支持真流式的场景
- **流式抗截断模式**：在模型名称前添加 `流式抗截断/` 前缀
  - 例：`流式抗截断/gemini-2.5-pro`  
  - 自动检测响应截断并重试，确保完整回答

### 🔧 模型功能自动检测
- 系统自动识别模型名称中的功能标识
- 透明地处理功能模式转换
- 支持功能组合使用

---

## 安装指南

### Docker 环境

**Docker 运行命令**
```bash
# 使用通用密码
docker run -d --name geminicli2api --network host -e PASSWORD=pwd -e PORT=7861 -v $(pwd)/data/creds:/app/creds ghcr.io/zhongruan0522/geminicli2api:latest

# 使用分离密码
docker run -d --name geminicli2api --network host -e API_PASSWORD=api_pwd -e PANEL_PASSWORD=panel_pwd -e PORT=7861 -v $(pwd)/data/creds:/app/creds ghcr.io/zhongruan0522/geminicli2api:latest
```

**Docker Compose 运行命令**
1. 将以下内容保存为 `docker-compose.yml` 文件：
    ```yaml
    version: '3.8'

    services:
      geminicli2api:
        image: ghcr.io/zhongruan0522/geminicli2api:latest
        container_name: geminicli2api
        restart: unless-stopped
        network_mode: host
        environment:
          # 使用通用密码（推荐用于简单部署）
          - PASSWORD=pwd
          - PORT=7861
          # 或使用分离密码（推荐用于生产环境）
          # - API_PASSWORD=your_api_password
          # - PANEL_PASSWORD=your_panel_password
        volumes:
          - ./data/creds:/app/creds
        healthcheck:
          test: ["CMD-SHELL", "python -c \"import sys, urllib.request, os; port = os.environ.get('PORT', '7861'); req = urllib.request.Request(f'http://localhost:{port}/v1/models', headers={'Authorization': 'Bearer ' + os.environ.get('PASSWORD', 'pwd')}); sys.exit(0 if urllib.request.urlopen(req, timeout=5).getcode() == 200 else 1)\""]
          interval: 30s
          timeout: 10s
          retries: 3
          start_period: 40s
    ```
2. 启动服务：
    ```bash
    docker-compose up -d
    ```

---

## 配置说明

1. 访问 `http://127.0.0.1:7861/auth` （默认端口，可通过 PORT 环境变量修改）
2. 完成 OAuth 认证流程（默认密码：`pwd`，可通过环境变量修改）

## 🏗️ 技术架构

### 核心模块说明

**认证和凭证管理** (`src/auth.py`, `src/credential_manager.py`)
- OAuth 2.0 认证流程管理
- 多凭证文件状态管理和轮换
- 自动故障检测和恢复
- JWT 令牌生成和验证

**API 路由和转换** (`src/openai_router.py`, `src/gemini_router.py`, `src/openai_transfer.py`)
- OpenAI 和 Gemini 格式双向转换
- 多模态输入处理（文本+图像）
- 思维链内容分离和处理
- 流式响应管理

**网络和代理** (`src/httpx_client.py`, `src/google_chat_api.py`)
- 统一 HTTP 客户端管理
- 代理配置和热更新支持
- 超时和重试策略
- 异步请求池管理

**状态管理** (`src/state_manager.py`, `src/usage_stats.py`)
- 原子化状态操作
- 使用统计和配额管理
- 文件锁和并发安全
- 数据持久化（TOML 格式）

**任务管理** (`src/task_manager.py`)
- 全局异步任务生命周期管理
- 资源清理和内存管理
- 优雅关闭和异常处理

**Web 控制台** (`src/web_routes.py`)
- RESTful API 端点
- WebSocket 实时通信
- 移动端适配检测
- 批量操作支持

### 高级特性实现

**流式抗截断机制** (`src/anti_truncation.py`)
- 检测响应截断模式
- 自动重试和状态恢复
- 上下文连接管理

**格式检测和转换** (`src/format_detector.py`)
- 自动检测请求格式（OpenAI vs Gemini）
- 无缝格式转换
- 参数映射和验证

**用户代理模拟** (`src/utils.py`)
- GeminiCLI 格式用户代理生成
- 平台检测和客户端元数据
- API 兼容性保证

### 环境变量配置

**基础配置**
- `PORT`: 服务端口（默认：7861）
- `HOST`: 服务器监听地址（默认：0.0.0.0）

**密码配置**
- `API_PASSWORD`: 聊天 API 访问密码（默认：继承 PASSWORD 或 pwd）
- `PANEL_PASSWORD`: 控制面板访问密码（默认：继承 PASSWORD 或 pwd）  
- `PASSWORD`: 通用密码，设置后覆盖上述两个（默认：pwd）

**性能和稳定性配置**
- `CALLS_PER_ROTATION`: 每个凭证轮换前的调用次数（默认：10）
- `RETRY_429_ENABLED`: 启用 429 错误自动重试（默认：true）
- `RETRY_429_MAX_RETRIES`: 429 错误最大重试次数（默认：3）
- `RETRY_429_INTERVAL`: 429 错误重试间隔，秒（默认：1.0）
- `ANTI_TRUNCATION_MAX_ATTEMPTS`: 抗截断最大重试次数（默认：3）

**网络和代理配置**
- `PROXY`: HTTP/HTTPS 代理地址（格式：`http://host:port`）
- `OAUTH_PROXY_URL`: OAuth 认证代理端点
- `GOOGLEAPIS_PROXY_URL`: Google APIs 代理端点
- `METADATA_SERVICE_URL`: 元数据服务代理端点

**自动化配置**
- `AUTO_BAN`: 启用凭证自动封禁（默认：true）
- `AUTO_LOAD_ENV_CREDS`: 启动时自动加载环境变量凭证（默认：false）

**兼容性配置**
- `COMPATIBILITY_MODE`: 启用兼容性模式，将 system 消息转为 user 消息（默认：false）

**日志配置**
- `LOG_LEVEL`: 日志级别（DEBUG/INFO/WARNING/ERROR，默认：INFO）
- `LOG_FILE`: 日志文件路径（默认：geminicli2api.log）


### API 使用方式

本服务支持两套完整的 API 端点：

#### 1. OpenAI 兼容端点

**端点：** `/v1/chat/completions`  
**认证：** `Authorization: Bearer your_api_password`

#### 2. Gemini 原生端点

**非流式端点：** `/v1/models/{model}:generateContent`  
**流式端点：** `/v1/models/{model}:streamGenerateContent`  
**模型列表：** `/v1/models`

**认证方式（任选一种）：**
- `Authorization: Bearer your_api_password`
- `x-goog-api-key: your_api_password`  
- URL 参数：`?key=your_api_password`

**说明：**
- OpenAI 端点返回 OpenAI 兼容格式
- Gemini 端点返回 Gemini 原生格式
- 两种端点使用相同的 API 密钥

## 📋 完整 API 参考

### Web 控制台 API

**认证端点**
- `POST /auth/login` - 用户登录
- `POST /auth/start` - 开始 OAuth 认证
- `POST /auth/callback` - 处理 OAuth 回调
- `GET /auth/status/{project_id}` - 检查认证状态

**凭证管理端点**
- `GET /creds/status` - 获取所有凭证状态
- `POST /creds/action` - 单个凭证操作（启用/禁用/删除）
- `POST /creds/batch-action` - 批量凭证操作
- `POST /auth/upload` - 批量上传凭证文件（支持 ZIP）
- `GET /creds/download/{filename}` - 下载凭证文件
- `GET /creds/download-all` - 打包下载所有凭证
- `POST /creds/fetch-email/{filename}` - 获取用户邮箱
- `POST /creds/refresh-all-emails` - 批量刷新用户邮箱

**配置管理端点**
- `GET /config/get` - 获取当前配置
- `POST /config/save` - 保存配置

**环境变量凭证端点**
- `POST /auth/load-env-creds` - 加载环境变量凭证
- `DELETE /auth/env-creds` - 清除环境变量凭证
- `GET /auth/env-creds-status` - 获取环境变量凭证状态

**日志管理端点**
- `POST /auth/logs/clear` - 清空日志
- `GET /auth/logs/download` - 下载日志文件
- `WebSocket /auth/logs/stream` - 实时日志流

**使用统计端点**
- `GET /usage/stats` - 获取使用统计
- `GET /usage/aggregated` - 获取聚合统计
- `POST /usage/update-limits` - 更新使用限制
- `POST /usage/reset` - 重置使用统计

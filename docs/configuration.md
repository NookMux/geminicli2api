# 配置说明

## 环境变量配置

### 基础配置

#### 服务配置
- **`PORT`**: 服务端口（默认：7861）
- **`HOST`**: 服务器监听地址（默认：0.0.0.0）

#### 密码配置
- **`API_PASSWORD`**: 聊天 API 访问密码（默认：继承 PASSWORD 或 pwd）
- **`PANEL_PASSWORD`**: 控制面板访问密码（默认：继承 PASSWORD 或 pwd）
- **`PASSWORD`**: 通用密码，设置后覆盖上述两个（默认：pwd）

**推荐设置**：
- 生产环境建议使用分离密码：`API_PASSWORD` 和 `PANEL_PASSWORD`
- 测试环境可使用通用密码：`PASSWORD`

### 性能和稳定性配置

#### 凭证轮换配置
- **`CALLS_PER_ROTATION`**: 每个凭证轮换前的调用次数（默认：10）
- **`AUTO_BAN`**: 启用凭证自动封禁（默认：true）

#### 重试配置
- **`RETRY_429_ENABLED`**: 启用 429 错误自动重试（默认：true）
- **`RETRY_429_MAX_RETRIES`**: 429 错误最大重试次数（默认：3）
- **`RETRY_429_INTERVAL`**: 429 错误重试间隔，秒（默认：1.0）
- **`ANTI_TRUNCATION_MAX_ATTEMPTS`**: 抗截断最大重试次数（默认：3）

### 网络和代理配置

#### 代理设置
- **`PROXY`**: HTTP/HTTPS 代理地址（格式：`http://host:port`）
- **`OAUTH_PROXY_URL`**: OAuth 认证代理端点
- **`GOOGLEAPIS_PROXY_URL`**: Google APIs 代理端点
- **`METADATA_SERVICE_URL`**: 元数据服务代理端点

**代理配置示例**：
```bash
PROXY=http://127.0.0.1:7890
OAUTH_PROXY_URL=http://127.0.0.1:7890
GOOGLEAPIS_PROXY_URL=http://127.0.0.1:7890
```

### 自动化配置

#### 凭证管理
- **`AUTO_LOAD_ENV_CREDS`**: 启动时自动加载环境变量凭证（默认：false）

### 兼容性配置

#### 消息格式
- **`COMPATIBILITY_MODE`**: 启用兼容性模式，将 system 消息转为 user 消息（默认：false）

### 日志配置

#### 日志级别
- **`LOG_LEVEL`**: 日志级别（DEBUG/INFO/WARNING/ERROR，默认：INFO）

## 配置文件设置

### TOML 配置文件

支持使用 TOML 格式的配置文件进行详细配置。配置文件优先级低于环境变量。

**配置文件位置**：`config.toml`

**示例配置**：
```toml
[server]
port = 7861
host = "0.0.0.0"

[auth]
api_password = "your_api_password"
panel_password = "your_panel_password"

[performance]
calls_per_rotation = 10
auto_ban = true

[retry]
retry_429_enabled = true
retry_429_max_retries = 3
retry_429_interval = 1.0
anti_truncation_max_attempts = 3

[proxy]
proxy_url = "http://127.0.0.1:7890"
oauth_proxy_url = "http://127.0.0.1:7890"
googleapis_proxy_url = "http://127.0.0.1:7890"

[logging]
log_level = "INFO"
log_file = "geminicli2api.log"
```

## 环境变量凭证支持

### GCLI_CREDS 格式

支持通过环境变量直接加载 Google OAuth 凭证：

**格式**：`GCLI_CREDS_{NAME}=base64_encoded_credentials`

**示例**：
```bash
export GCLI_CREDS_ACCOUNT1="$(cat account1.json | base64 -w 0)"
export GCLI_CREDS_ACCOUNT2="$(cat account2.json | base64 -w 0)"
export GCLI_CREDS_ACCOUNT3="$(cat account3.json | base64 -w 0)"
```

**自动加载**：
- 设置 `AUTO_LOAD_ENV_CREDS=true` 启动时自动加载
- 支持多个凭证文件同时加载
- Base64 编码确保环境变量安全性

## Docker 配置

### Docker 环境变量

**通用密码配置**：
```bash
docker run -d \
  --name gcli2api \
  --network host \
  -e PASSWORD=pwd \
  -e PORT=7861 \
  -v $(pwd)/data/creds:/app/creds \
  ghcr.io/zhongruan0522/geminicli2api:latest
```

**分离密码配置**：
```bash
docker run -d \
  --name gcli2api \
  --network host \
  -e API_PASSWORD=api_pwd \
  -e PANEL_PASSWORD=panel_pwd \
  -e PORT=7861 \
  -v $(pwd)/data/creds:/app/creds \
  ghcr.io/zhongruan0522/geminicli2api:latest
```

**代理配置**：
```bash
docker run -d \
  --name gcli2api \
  --network host \
  -e PASSWORD=pwd \
  -e PROXY=http://host:port \
  -e OAUTH_PROXY_URL=http://host:port \
  -e GOOGLEAPIS_PROXY_URL=http://host:port \
  -v $(pwd)/data/creds:/app/creds \
  ghcr.io/zhongruan0522/geminicli2api:latest
```

### Docker Compose 配置

**完整配置示例**：
```yaml
version: '3.8'

services:
  gcli2api:
    image: ghcr.io/zhongruan0522/geminicli2api:latest
    container_name: gcli2api
    restart: unless-stopped
    network_mode: host
    environment:
      # 密码配置
      - API_PASSWORD=your_api_password
      - PANEL_PASSWORD=your_panel_password

      # 服务配置
      - PORT=7861
      - HOST=0.0.0.0

      # 性能配置
      - CALLS_PER_ROTATION=15
      - AUTO_BAN=true

      # 重试配置
      - RETRY_429_ENABLED=true
      - RETRY_429_MAX_RETRIES=5
      - RETRY_429_INTERVAL=2.0
      - ANTI_TRUNCATION_MAX_ATTEMPTS=3

      # 代理配置（如需要）
      # - PROXY=http://127.0.0.1:7890
      # - OAUTH_PROXY_URL=http://127.0.0.1:7890
      # - GOOGLEAPIS_PROXY_URL=http://127.0.0.1:7890

      # 日志配置
      - LOG_LEVEL=INFO
      - LOG_FILE=geminicli2api.log

      # 自动化配置
      - AUTO_LOAD_ENV_CREDS=false
      - COMPATIBILITY_MODE=false

    volumes:
      - ./data/creds:/app/creds
      - ./config.toml:/app/config.toml

    healthcheck:
      test: ["CMD-SHELL", "python -c \"import sys, urllib.request, os; port = os.environ.get('PORT', '7861'); req = urllib.request.Request(f'http://localhost:{port}/v1/models', headers={'Authorization': 'Bearer ' + os.environ.get('API_PASSWORD', 'pwd')}); sys.exit(0 if urllib.request.urlopen(req, timeout=5).getcode() == 200 else 1)\""]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

## 配置最佳实践

### 安全配置
1. **使用分离密码**：生产环境建议为 API 和控制面板设置不同密码
2. **定期更换密码**：定期更新访问密码增强安全性
3. **环境变量保护**：确保敏感环境变量不被意外泄露

### 性能优化
1. **调整轮换次数**：根据 API 限制调整 `CALLS_PER_ROTATION`
2. **配置重试策略**：根据网络状况调整重试参数
3. **启用自动封禁**：避免使用故障凭证影响服务稳定性

### 监控配置
1. **设置日志级别**：开发环境使用 DEBUG，生产环境使用 INFO
2. **配置日志文件**：确保日志文件有足够的存储空间
3. **启用健康检查**：Docker 环境启用健康检查确保服务可用性

### 代理配置
1. **统一代理端点**：所有代理端点使用相同的代理服务器
2. **代理测试**：配置代理前先测试代理服务器可用性
3. **备用方案**：准备代理失效时的备用访问方案
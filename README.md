# GeminiCLI2API

## 📋 支持的模型

### 基础模型
- `gemini-2.5-pro`
- `gemini-3-pro-preview`
- `gemini-2.5-flash`


## 🚀 快速开始

**Docker Compose 部署**
```yaml
version: '3.8'

services:
  gcli2api:
    image: ghcr.io/zhongruan0522/geminicli2api:分支名
    container_name: gcli2api
    restart: unless-stopped
    network_mode: host
    environment:
      - PORT=7861
    volumes:
      - ./data/creds:/app/creds
```

启动服务：
```bash
docker-compose up -d
```

## 🔧 初始配置

1. **访问 Web 控制台**：`http://127.0.0.1:7861/`
2. **登录认证**：使用默认密码 `pwd`（或你设置的密码）
3. **完成 OAuth 流程**：按照指引完成 Google OAuth 认证
4. **上传凭证文件**：在控制台中上传你的 Google OAuth 凭证

> 当前为Beta分支，极度不稳定，请勿在生产环境上拉取

# GeminiCLI to API

**将 GeminiCLI 转换为 OpenAI 和 GEMINI API 接口**

## 📋 支持的模型

### 基础模型
- `gemini-2.5-pro`
- `gemini-2.5-pro-preview-06-05`
- `gemini-2.5-pro-preview-05-06`
- `gemini-2.5-flash`
- `gemini-2.5-flash-image-preview` 🎨 **绘图模型**
- `gemini-2.5-flash-image` 🎨 **绘图模型**

### 特色功能
- **思维模型**：`gemini-2.5-pro-maxthinking`
- **绘图模型**：`gemini-2.5-flash-image-preview` - 图像生成和编辑

## 🚀 快速开始

### Docker 部署（推荐）

**基础部署**
```bash
docker run -d --name gcli2api --network host \
  -e PASSWORD=pwd -e PORT=7861 \
  -v $(pwd)/data/creds:/app/creds \
  ghcr.io/zhongruan0522/geminicli2api:beta
```

**Docker Compose 部署**
```yaml
version: '3.8'

services:
  gcli2api:
    image: ghcr.io/zhongruan0522/geminicli2api:beta
    container_name: gcli2api
    restart: unless-stopped
    network_mode: host
    environment:
      - PASSWORD=pwd
      - PORT=7861
    volumes:
      - ./data/creds:/app/creds
```

启动服务：
```bash
docker-compose up -d
```

## 🔧 初始配置

1. **访问 Web 控制台**：`http://127.0.0.1:7861/auth`
2. **登录认证**：使用默认密码 `pwd`（或你设置的密码）
3. **完成 OAuth 流程**：按照指引完成 Google OAuth 认证
4. **上传凭证文件**：在控制台中上传你的 Google OAuth 凭证
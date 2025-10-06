# GeminiCLI to API

**将 GeminiCLI 转换为 OpenAI 和 GEMINI API 接口**

## ✨ 主要特性

- 🔄 **双端点支持**：同时提供 OpenAI 兼容和 Gemini 原生 API 接口
- 🔐 **灵活认证**：支持多种认证方式和分离密码配置
- 📊 **智能凭证管理**：多凭证自动轮换、负载均衡和故障恢复
- 🌊 **流式响应**：真流式和假流式模式，支持抗截断功能
- 🎛️ **Web 控制台**：完整的 Web 管理界面，支持移动端
- 📈 **实时监控**：使用统计、日志查看和系统监控

## 📋 支持的模型

### 基础模型
- `gemini-2.5-pro`
- `gemini-2.5-pro-preview-06-05`
- `gemini-2.5-pro-preview-05-06`
- `gemini-2.5-flash`
- `gemini-2.5-flash-image-preview` 🎨 **绘图模型**

### 特色功能
- **思维模型**：`gemini-2.5-pro-maxthinking`、`gemini-2.5-pro-nothinking`
- **搜索增强**：`gemini-2.5-pro-search`
- **绘图模型**：`gemini-2.5-flash-image-preview` - 图像生成和编辑
- **特殊模式**：支持假流式模式和流式抗截断功能

## 🚀 快速开始

### Docker 部署（推荐）

**基础部署**
```bash
docker run -d --name gcli2api --network host \
  -e PASSWORD=pwd -e PORT=7861 \
  -v $(pwd)/data/creds:/app/creds \
  ghcr.io/zhongruan0522/geminicli2api:latest
```

**Docker Compose 部署**
```yaml
version: '3.8'

services:
  gcli2api:
    image: ghcr.io/zhongruan0522/geminicli2api:latest
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

## 📖 详细文档

- [🚀 部署指南](docs/deployment.md) - 完整的部署和配置说明
- [📡 API 参考](docs/api-reference.md) - API 接口详细文档
- [✨ 功能特性](docs/features.md) - 详细功能介绍
- [🏗️ 技术架构](docs/architecture.md) - 系统架构说明
- [⚙️ 配置说明](docs/configuration.md) - 环境变量和配置详解
- [🔧 故障排除](docs/troubleshooting.md) - 常见问题和解决方案

## 📋 更多信息

- [📝 更新日志](CHANGELOG.md) - 版本更新记录
- [🤝 贡献指南](CONTRIBUTING.md) - 如何参与项目开发

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

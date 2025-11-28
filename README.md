# GeminiCLI2API

## 支持的模型

- `gemini-2.5-pro`
- `gemini-3-pro-preview`
- `gemini-2.5-flash`

## 🚀 快速开始

选择合适的Yml文件下载
- `docker-compose.yml`：适合直接部署
- `docker-compose-vpn.yml`：适合有代理节点的时候部署


启动服务：
```bash
docker-compose up -d
```

## 🔧 初始配置

1. **访问 Web 控制台**：`http://127.0.0.1:7861/`
2. **登录认证**：使用默认密码 `pwd`（或你设置的密码）
3. **完成 OAuth 流程**：按照指引完成 Google OAuth 认证
4. **上传凭证文件**：在控制台中上传你的 Google OAuth 凭证

# 项目开发

- `CodexCli`-`GPT-5.1-High`：负责后端开发
- `ClaudeCode`-`GLM-4.6`：负责前端开发
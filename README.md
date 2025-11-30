# GeminiCLI2API

## 项目开发

> 当前为全AI开发

- `CodexCli`-`GPT-5.1-High`：负责后端开发
- `ClaudeCode`-`GLM-4.6`：负责前端开发

## 支持的模型

- `gemini-2.5-pro`
- `gemini-3-pro-preview`
- `gemini-2.5-flash`

## Docker部署

选择合适的Yml文件下载
- `docker-compose.yml`：适合直接部署
- `docker-compose-vpn.yml`：适合有代理节点的时候部署
- `docker-compose-cluster.yml`：适合集群部署，一个使用本机IP一个使用代理

启动服务：
```bash
docker-compose up -d
```


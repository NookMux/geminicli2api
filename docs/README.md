# GeminiCLI to API 文档

本文档目录包含了项目的详细技术文档和使用说明。

## 📚 文档结构

### [🚀 部署指南](deployment.md)
Docker 部署和配置说明，包括：
- Docker 基础部署
- Docker Compose 部署
- 环境变量配置
- 初始配置步骤
- 常见问题解决

### [📡 API 参考](api-reference.md)
API 接口详细文档，包括：
- OpenAI 兼容端点
- Gemini 原生端点
- Web 控制台 API
- 支持的模型
- 认证方式
- 请求和响应格式

### [✨ 功能特性](features.md)
详细功能介绍，包括：
- 认证和安全管理
- 智能凭证管理系统
- 流式传输和响应处理
- Web 管理控制台
- 使用统计和监控
- 高级配置和自定义
- 环境变量和配置管理
- 思维模型功能
- 搜索增强功能

### [🏗️ 技术架构](architecture.md)
系统架构说明，包括：
- 核心模块说明
- 高级特性实现
- 数据流架构
- 并发处理架构
- 配置管理架构
- 安全架构

### [⚙️ 配置说明](configuration.md)
环境变量和配置详解，包括：
- 环境变量配置
- TOML 配置文件
- 环境变量凭证支持
- Docker 配置
- 配置最佳实践

### [🔧 故障排除](troubleshooting.md)
常见问题和解决方案，包括：
- 认证问题诊断
- API 连接故障
- 凭证管理问题
- Docker 容器问题
- 性能优化建议

## 🚀 快速开始

如果你是第一次使用这个项目，建议按照以下顺序阅读文档：

1. 首先阅读主 [README.md](../README.md) 了解项目基本信息
2. 阅读 [部署指南](deployment.md) 来部署服务
3. 阅读 [配置说明](configuration.md) 来配置你的服务
4. 阅读 [API 参考](api-reference.md) 来了解如何使用 API

## 🔍 常见问题

### 如何开始使用？

1. 按照主 README 中的说明进行 Docker 部署
2. 访问 Web 控制台完成 OAuth 认证
3. 上传你的 Google OAuth 凭证文件
4. 开始使用 API 接口

### 遇到问题怎么办？

1. 查看 [部署指南](deployment.md) 中的故障排除部分
2. 检查日志文件获取详细错误信息
3. 在 GitHub 上提交 Issue

### 需要更多功能？

查看 [功能特性](features.md) 了解所有可用功能，或在 [配置说明](configuration.md) 中了解高级配置选项。
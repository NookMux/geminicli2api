# 基础镜像 - 使用更小的 alpine 版本
FROM python:3.13-alpine

WORKDIR /app

# 安装构建依赖并清理包管理器缓存
RUN apk add --no-cache gcc musl-dev && \
    pip install --no-cache-dir -r requirements.txt && \
    apk del gcc musl-dev

# 复制应用代码
COPY . .

# 创建非 root 用户
RUN adduser -D -s /bin/sh appuser && \
    chown -R appuser:appuser /app
USER appuser

# 默认启动命令
CMD ["python", "web.py"]
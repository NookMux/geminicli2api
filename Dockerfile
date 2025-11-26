# 基础镜像 - 使用更小的 alpine 版本
FROM python:3.13-alpine

WORKDIR /app

# 仅复制依赖文件用于缓存层
COPY requirements.txt .

# Python 依赖 
RUN pip install -r requirements.txt

# 复制其余代码
COPY . .

# 默认启动命令
CMD ["python", "web.py"]
# Antigravity2api-nodejs

## 项目说明

当前项目是基于[liuw1535](https://github.com/liuw1535) 大佬的 [antigravity2api-nodejs](https://github.com/liuw1535/antigravity2api-nodejs) 做的修改和迭代

## 免责声明

仅供个人学习，出事与项目负责人无关

## 启动方式

编写`docker-compose.yml`文件

> 必须设置的三个环境变量
> 1. `API_KEY`：调用API的KEY
> 2. `PANEL_PASSWORD`:面板登录密码
> 3. `PANEL_USER`:面板用户名

~~~yml
version: '3.8'
services:
  antigravity-api:
    image: ghcr.io/zhongruan0522/antigravity2api-node-js:latest
    container_name: antigravity-api
    restart: unless-stopped
    ports:
      - "8045:8045"
    environment:
      - PANEL_USER=admin
      - PANEL_PASSWORD=设置你的密码
      - API_KEY=sk-text
      - IMAGE_BASE_URL=设置图像访问地址，如果是服务器部署有域名写域名，无域名写IP:8045，本地不写
    volumes:
      - ./data:/app/data
    healthcheck:
      test: [ "CMD", "node", "-e", "require('http').get('http://localhost:' + process.env.PORT + '/healthz', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))" ]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
~~~

输入`docker compose up -d`启动，启动成功后访问`http://IP:8045`即可访问面板

## 环境变量配置

详见`.env.example`文件

## 文档

[点击访问](https://docs.zxiaoruan.cn/antigravity2api/%E9%83%A8%E7%BD%B2%E6%95%99%E7%A8%8B/docker)

## 交流

QQ群：`937931004`

## 常见问题

1. CC报错404

> 1.检查路径是否有无V1,有请删除
> 2.检查模型ID是否为模型列表里面的

2. 凭证报错403

> 1. 尝试自动获取项目ID或者手动输入项目ID或者使用随机项目ID

3. 给G-3-P-I设置分辨率 ？

> 试一试一下模型ID
> gemini-3-pro-image-1k
> gemini-3-pro-image-2k
> gemini-3-pro-image-4k
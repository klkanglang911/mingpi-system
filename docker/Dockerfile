FROM node:18-alpine

WORKDIR /app

# 复制 package.json 并安装依赖
COPY server/package*.json ./
RUN npm ci --only=production

# 复制应用代码
COPY server/src ./src
COPY public ./public

# 创建数据目录
RUN mkdir -p /app/data

# 环境变量
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/mingpi.db

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["node", "src/app.js"]

FROM node:18-alpine

RUN apk add --no-cache git

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY . .

VOLUME ["/app/auth_info", "/app/users", "/app/chats"]

CMD ["npm", "start"]

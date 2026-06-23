FROM node:18-alpine

# Install system utilities
RUN apk add --no-cache git

WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install production-only dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Create directory mounts for persistent storage
VOLUME ["/app/auth_info", "/app/users", "/app/chats"]

CMD ["npm", "start"]

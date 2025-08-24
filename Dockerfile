# Multi-stage Docker build for DomaAlert Bot
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/
COPY .env.example ./.env.example

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S domaalert -u 1001

# Production stage
FROM node:18-alpine AS production

# Install sqlite3 and other runtime dependencies
RUN apk add --no-cache sqlite

WORKDIR /app

# Copy built application
COPY --from=builder --chown=domaalert:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=domaalert:nodejs /app/src ./src
COPY --from=builder --chown=domaalert:nodejs /app/package*.json ./

# Create necessary directories
RUN mkdir -p data logs && \
    chown -R domaalert:nodejs data logs

# Switch to non-root user
USER domaalert

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start application
CMD ["node", "src/index.js"]
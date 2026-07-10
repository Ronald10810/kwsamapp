FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm config set fetch-retries 5 \
	&& npm config set fetch-retry-mintimeout 20000 \
	&& npm config set fetch-retry-maxtimeout 120000 \
	&& if [ -f package-lock.json ]; then \
		for i in 1 2 3; do npm ci && break || { [ "$i" -eq 3 ] && exit 1; echo "npm ci failed (attempt $i), retrying..."; sleep 5; }; done; \
	else \
		for i in 1 2 3; do npm install && break || { [ "$i" -eq 3 ] && exit 1; echo "npm install failed (attempt $i), retrying..."; sleep 5; }; done; \
	fi

COPY . .
RUN npm run build

FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm config set fetch-retries 5 \
	&& npm config set fetch-retry-mintimeout 20000 \
	&& npm config set fetch-retry-maxtimeout 120000 \
	&& if [ -f package-lock.json ]; then \
		for i in 1 2 3; do npm ci --omit=dev && break || { [ "$i" -eq 3 ] && exit 1; echo "npm ci --omit=dev failed (attempt $i), retrying..."; sleep 5; }; done; \
	else \
		for i in 1 2 3; do npm install --omit=dev && break || { [ "$i" -eq 3 ] && exit 1; echo "npm install --omit=dev failed (attempt $i), retrying..."; sleep 5; }; done; \
	fi \
	&& npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY prisma ./prisma

EXPOSE 3000

CMD ["node", "dist/index.js"]

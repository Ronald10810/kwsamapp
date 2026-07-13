FROM node:20-alpine AS builder
WORKDIR /app

ARG VITE_API_BASE_URL
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_COMMUNICATIONS_CONSOLE_ENABLED
ARG VITE_PORTAL_RECOVERY_ENABLED
ARG VITE_TRAINING_HUB_ENABLED

COPY package*.json ./
RUN npm ci

COPY . .
# For Cloud Run source deploys, prefer explicit build args when provided.
# Otherwise fall back to the checked-in/generated env file.
RUN if [ -n "$VITE_API_BASE_URL" ] || [ -n "$VITE_GOOGLE_CLIENT_ID" ] || [ -n "$VITE_COMMUNICATIONS_CONSOLE_ENABLED" ] || [ -n "$VITE_PORTAL_RECOVERY_ENABLED" ] || [ -n "$VITE_TRAINING_HUB_ENABLED" ]; then \
			: > .env.production; \
			[ -n "$VITE_API_BASE_URL" ] && echo "VITE_API_BASE_URL=$VITE_API_BASE_URL" >> .env.production; \
			[ -n "$VITE_GOOGLE_CLIENT_ID" ] && echo "VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID" >> .env.production; \
			[ -n "$VITE_COMMUNICATIONS_CONSOLE_ENABLED" ] && echo "VITE_COMMUNICATIONS_CONSOLE_ENABLED=$VITE_COMMUNICATIONS_CONSOLE_ENABLED" >> .env.production; \
			[ -n "$VITE_PORTAL_RECOVERY_ENABLED" ] && echo "VITE_PORTAL_RECOVERY_ENABLED=$VITE_PORTAL_RECOVERY_ENABLED" >> .env.production; \
			[ -n "$VITE_TRAINING_HUB_ENABLED" ] && echo "VITE_TRAINING_HUB_ENABLED=$VITE_TRAINING_HUB_ENABLED" >> .env.production; \
		elif [ -f env.production.generated ]; then \
			cp env.production.generated .env.production; \
		fi
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]

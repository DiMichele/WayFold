FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
ENV HOST=0.0.0.0 PORT=7900
USER node
EXPOSE 7900
CMD ["node", "server.mjs"]

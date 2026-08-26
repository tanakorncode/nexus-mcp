FROM node:20-alpine
WORKDIR /app
COPY server.mjs lib.mjs package.json ./
ENV PORT=8091
EXPOSE 8091
CMD ["node", "server.mjs"]

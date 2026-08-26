FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.mjs ./
ENV PORT=8092
EXPOSE 8092
CMD ["node", "server.mjs"]

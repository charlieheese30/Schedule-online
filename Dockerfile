FROM node:22-bullseye

# Install system build deps required for compiling native modules (better-sqlite3)
RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential python3 pkg-config libsqlite3-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Install node deps early (cache)
COPY package.json package-lock.json* ./
RUN npm install

# Copy application
COPY . .

EXPOSE 3000
ENV PORT=3000

CMD ["node", "server.js"]

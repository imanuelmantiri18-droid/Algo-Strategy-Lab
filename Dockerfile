FROM node:20-alpine

RUN npm install -g pnpm@9.15.0

WORKDIR /app

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./

COPY lib/api-zod/ ./lib/api-zod/
COPY lib/db/ ./lib/db/
COPY artifacts/api-server/ ./artifacts/api-server/

RUN pnpm install --no-frozen-lockfile --ignore-scripts

CMD ["pnpm", "--filter", "@workspace/api-server", "run", "live", "--", \
     "--strategy=fractal_breakout", \
     "--interval=1h", \
     "--leverage=20", \
     "--risk=10", \
     "--capital=100", \
     "--symbol=BTCUSDT"]

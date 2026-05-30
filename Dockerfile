FROM node:20-alpine

RUN npm install -g tsx@4.21.0

WORKDIR /app

COPY artifacts/api-server/src/ ./src/

CMD ["tsx", "src/scripts/live-bot.ts", \
     "--strategy=fractal_breakout", \
     "--interval=1h", \
     "--leverage=20", \
     "--risk=10", \
     "--capital=100", \
     "--symbol=BTCUSDT"]

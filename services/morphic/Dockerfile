FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY services/morphic/package*.json services/morphic/
RUN npm ci --prefix services/morphic --ignore-scripts
COPY services/morphic services/morphic
COPY src/lib/research.ts src/lib/research.ts
COPY src/lib/local/public-web.ts src/lib/local/public-web.ts
RUN node services/morphic/build.mjs
FROM node:22-bookworm-slim
WORKDIR /app/services/morphic
COPY --from=build --chown=node:node /app/services/morphic/node_modules node_modules
COPY --from=build --chown=node:node /app/services/morphic/dist dist
COPY --from=build --chown=node:node /app/services/morphic/LICENSE LICENSE
COPY --from=build --chown=node:node /app/services/morphic/NOTICE NOTICE
USER node
ENV SIAAS_RESEARCH_BIND=0.0.0.0
CMD ["node", "dist/server.mjs"]

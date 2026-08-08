# Build the static bundle, then ship it with the small Node server that serves
# it and proxies Jellyseerr. The server is what makes the Jellyseerr address
# editable from the dashboard, so this is not a static-only image.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Baked into the bundle at build time; only prefills the sign-in form.
ARG VITE_JELLYFIN_SERVER=""
ENV VITE_JELLYFIN_SERVER=$VITE_JELLYFIN_SERVER
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4173

# Explicit paths rather than relying on the working directory: anything written
# into a VOLUME by a later layer is discarded, so symlinking into /config here
# would silently vanish at runtime.
ENV APOLLO_DIST=/app/dist
ENV APOLLO_CONFIG=/config/apollo.runtime.json

# No dependencies at runtime: the server uses only the Node standard library.
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./package.json

# Holds apollo.runtime.json — mount it to keep the Jellyseerr address across
# container rebuilds.
RUN mkdir -p /config
VOLUME ["/config"]

EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:4173/__apollo/config >/dev/null || exit 1

CMD ["node", "/app/server/index.mjs"]

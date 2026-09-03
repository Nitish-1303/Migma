# Zero runtime dependencies, so there is no install layer and nothing to audit: the
# image is the base runtime plus this source tree.
FROM node:22-alpine

ENV NODE_ENV=production \
    # A container's loopback is not reachable from outside it, so the bind widens
    # here and access control stays where it belongs -- the CORS allowlist, the
    # Spotify check and the network in front of this.
    HOST=0.0.0.0 \
    PORT=8788

WORKDIR /app

# Copied by name rather than with a wildcard: an .env that appears in the build
# context cannot be swept into the image by accident.
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY routes ./routes

USER node
EXPOSE 8788

# node is PID 1 and installs its own SIGTERM handler, so --init is not needed for
# the shutdown path to run.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD \
  node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8788)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

FROM node:20-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Declare all VITE_ build-time vars so DO App Platform passes them during docker build
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_MEASUREMENT_ID
ARG VITE_PHONE_OTP_PROVIDER

# Make ARGs available as env vars for Vite during build
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID
ENV VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID
ENV VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN
ENV VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET
ENV VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID
ENV VITE_FIREBASE_MEASUREMENT_ID=$VITE_FIREBASE_MEASUREMENT_ID
ENV VITE_PHONE_OTP_PROVIDER=$VITE_PHONE_OTP_PROVIDER

# Non-secret build provenance: the S3-sourced CodeBuild pipeline has no .git,
# so script/build.mjs needs this supplied explicitly to embed a real commit
# SHA in BUILD_COMMIT_SHA instead of falling back to "unknown".
ARG GIT_COMMIT_SHA
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA

COPY . .
RUN npm run build

FROM node:20-slim AS runner

WORKDIR /app

# glibc base (not alpine/musl) -- @livekit/rtc-ffi-bindings, the translator
# bot's native LiveKit dependency, only ships prebuilt binaries for
# linux-x64-gnu/linux-arm64-gnu, not musl. On alpine those optional
# platform packages never installed, so the native binding silently failed
# to load and every translator-bot start crashed with a generic
# "Cannot read properties of undefined (reading 'has')" once code inside
# the binding's JS wrapper touched the missing native object.
#
# ffmpeg is a real runtime dependency (server/ai_integrations/audio/client.ts,
# server/lip-sync.ts); wget is needed for the HEALTHCHECK below -- neither
# ships in the slim base image.
#
# ca-certificates: Node bundles its own CA list, but the LiveKit native
# binding (Rust) reads the system store. Without it every translator-bot
# join failed with "failed to retrieve region info: error sending request".
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg wget \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

EXPOSE 5000
ENV NODE_ENV=production
ENV PORT=5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:5000/healthz || exit 1

CMD ["npm", "start"]

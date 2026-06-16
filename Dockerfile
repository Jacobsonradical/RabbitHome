# Multi-stage build: build the frontend, embed it into the Go binary, then ship
# a tiny runtime image. This is the "anyone can run it" path (web app on :7171).

# 1) Build the React frontend.
FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# 2) Build the Go binary with the freshly built frontend embedded.
FROM golang:1.26-alpine AS gobuild
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /app/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -o /rabbithome ./

# 3) Minimal runtime.
FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=gobuild /rabbithome /usr/local/bin/rabbithome
# Persist dashboard config + uploaded backgrounds here (mount a volume).
ENV RABBITHOME_DATA=/data
VOLUME /data
EXPOSE 7171
# Headless container: serve only, bound to all interfaces.
ENTRYPOINT ["rabbithome", "--serve", "--addr", "0.0.0.0:7171"]

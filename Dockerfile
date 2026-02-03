FROM golang:1.22-alpine AS build

RUN apk add --no-cache git

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN ./build.sh
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/battlebox .

FROM gcr.io/distroless/base-debian12
WORKDIR /app
ENV PORT=8080
COPY --from=build /app/battlebox /app/battlebox
EXPOSE 8080
USER nonroot:nonroot
CMD ["/app/battlebox"]

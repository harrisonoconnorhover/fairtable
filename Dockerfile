FROM node:24-bookworm-slim AS node

FROM rust:1.95-bookworm AS build
COPY --from=node /usr/local/ /usr/local/
WORKDIR /build
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates ./crates
COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm \
    && corepack prepare pnpm@11.25.0 --activate \
    && pnpm install --frozen-lockfile \
    && rustup target add wasm32-unknown-unknown \
    && rustup component add rust-docs \
    && cargo install wasm-bindgen-cli --version 0.2.108 --locked
COPY index.html tsconfig.json vite.config.ts ./
COPY LICENSE ./
COPY public ./public
COPY web ./web
COPY scripts ./scripts
RUN pnpm run build \
    && node scripts/generate-notices.mjs \
    && cargo build --locked --release -p fairtable-server

FROM debian:bookworm-slim AS runtime
RUN useradd --system --uid 10001 --create-home fairtable \
    && mkdir /data && chown fairtable:fairtable /data
COPY --from=build /build/target/release/fairtable-server /usr/local/bin/fairtable
USER fairtable
ENV FAIRTABLE_HOST=0.0.0.0 FAIRTABLE_PORT=7777 FAIRTABLE_DATA=/data/fairtable.sqlite3
VOLUME ["/data"]
EXPOSE 7777
ENTRYPOINT ["/usr/local/bin/fairtable"]

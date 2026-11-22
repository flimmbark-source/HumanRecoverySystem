FROM mcr.microsoft.com/devcontainers/javascript-node:22-bookworm

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-15 \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/usr/lib/postgresql/15/bin:${PATH}"

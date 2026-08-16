# syntax=docker/dockerfile:1.7

# Linux/amd64 is intentional: the authoritative homelab machine is x86-64.
# Both the Node image manifest and Chrome archive are immutable inputs.
FROM node:24.14.1-bookworm-slim@sha256:e484ae3f1e3c378021c967fd42254f343c302a9263e412280eac32bf5bca7008

ARG DEBIAN_SNAPSHOT=20260816T000000Z
ARG CHROME_VERSION=150.0.7871.46
ARG CHROME_SHA256=ad115a7498a17f53f6ed0914458326c6516addc756224db14c32184a9b1ab078
ARG PNPM_VERSION=10.33.0

# Snapshot URLs make the native browser/toolchain dependencies reproducible;
# ordinary Debian mirrors would silently change the image between captures.
RUN rm -f /etc/apt/sources.list.d/debian.sources \
  && printf '%s\n' \
    "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT} bookworm main" \
    "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT} bookworm-updates main" \
    "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT} bookworm-security main" \
    > /etc/apt/sources.list \
  && apt-get -o Acquire::Check-Valid-Until=false update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    fonts-liberation \
    g++ \
    git \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    make \
    python3 \
    unzip \
  && rm -rf /var/lib/apt/lists/*

RUN curl --fail --location --retry 3 \
    "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-linux64.zip" \
    --output /tmp/chrome.zip \
  && echo "${CHROME_SHA256}  /tmp/chrome.zip" | sha256sum --check --strict \
  && unzip -q /tmp/chrome.zip -d /opt \
  && mv /opt/chrome-linux64 /opt/chrome \
  && ln -s /opt/chrome/chrome /usr/local/bin/google-chrome \
  && rm /tmp/chrome.zip \
  && google-chrome --version | grep --fixed-strings "${CHROME_VERSION}"

RUN npm install --global "pnpm@${PNPM_VERSION}" \
  && test "$(pnpm --version)" = "${PNPM_VERSION}"

COPY benchmark-entrypoint.sh /usr/local/bin/llui-benchmark-entrypoint
RUN chmod 0755 /usr/local/bin/llui-benchmark-entrypoint

ENV CHROME_BIN=/opt/chrome/chrome \
    HOME=/tmp/llui-benchmark-home \
    npm_config_cache=/cache/npm

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/llui-benchmark-entrypoint"]

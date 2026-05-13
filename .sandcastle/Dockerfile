FROM node:22-bookworm

ARG AGENT_UID=501
ARG AGENT_GID=20

RUN apt-get update && apt-get install -y \
  git \
  curl \
  jq \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.12.4 --activate

RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  EXISTING_GROUP="$(getent group "${AGENT_GID}" | cut -d: -f1 || true)"; \
  if [ -n "${EXISTING_GROUP}" ]; then \
    usermod -u "${AGENT_UID}" -g "${AGENT_GID}" -d /home/agent -m -l agent node; \
  else \
    groupmod -g "${AGENT_GID}" node; \
    usermod -u "${AGENT_UID}" -g "${AGENT_GID}" -d /home/agent -m -l agent node; \
  fi

RUN npm install -g @openai/codex

USER agent
WORKDIR /workspace

CMD ["sleep", "infinity"]

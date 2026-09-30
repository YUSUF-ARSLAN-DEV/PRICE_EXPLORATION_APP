# syntax=docker/dockerfile:1.7
# Build context: the repository root.
#   docker build -f services/Dockerfile --target ingest  -t qarib-ingest  .
#   docker build -f services/Dockerfile --target matcher -t qarib-matcher .
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN useradd --system --create-home qarib
WORKDIR /app

FROM base AS ingest
COPY services/ingest /app/services/ingest
RUN pip install "/app/services/ingest[azure]"
USER qarib
ENTRYPOINT ["qarib-ingest"]
CMD ["health"]

FROM base AS matcher
COPY services/ingest /app/services/ingest
COPY services/matcher /app/services/matcher
RUN pip install /app/services/ingest "/app/services/matcher"
USER qarib
ENTRYPOINT ["qarib-match"]
CMD ["run"]

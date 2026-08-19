FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MANIM_DISABLE_CACHING=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ffmpeg \
      libcairo2-dev \
      libpango1.0-dev \
      pkg-config \
      gcc \
      g++ \
      make \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt manim==0.19.0
COPY app ./app
RUN mkdir -p /app/workspaces && useradd --create-home --uid 10001 renderer \
    && chown -R renderer:renderer /app

USER renderer
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

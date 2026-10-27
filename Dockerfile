FROM debian:bookworm-slim AS inference
RUN apt-get update && apt-get install -y --no-install-recommends git cmake build-essential ca-certificates && rm -rf /var/lib/apt/lists/*
# Pinned upstream llama.cpp revision (tag b5046).
RUN git clone https://github.com/ggml-org/llama.cpp /tmp/llama && cd /tmp/llama && git checkout 74d4f5b041ad837153b0e90fc864b8290e01d8d5 && cmake -B /tmp/llama-out -S . -DGGML_NATIVE=OFF -DLLAMA_CURL=OFF -DBUILD_SHARED_LIBS=OFF -DLLAMA_BUILD_TESTS=OFF && cmake --build /tmp/llama-out --target llama-cli -j2

FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 ca-certificates && rm -rf /var/lib/apt/lists/* && useradd --uid 10001 --create-home nano
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=inference /tmp/llama-out/bin/llama-cli /usr/local/bin/llama-cli
COPY backend ./backend
COPY scripts ./scripts
RUN mkdir -p /var/lib/nano/data /var/lib/nano/models /opt/nano-source && chown -R nano:nano /var/lib/nano /opt/nano-source
USER nano
ENV NANO_DATA_DIR=/var/lib/nano/data NANO_MODEL_PATH=/var/lib/nano/models/Llama-3.2-1B-Instruct-Q4_0.gguf NANO_LLAMA_PATH=/usr/local/bin/llama-cli NANO_SOURCE_DIR=/opt/nano-source PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 8000
HEALTHCHECK --start-period=300s --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=4)"
CMD ["python", "-m", "uvicorn", "backend.api:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log", "--timeout-graceful-shutdown", "20"]

FROM python:3.11-slim
WORKDIR /service
COPY services/laya/requirements.txt .
RUN pip install --no-cache-dir torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt
RUN useradd --create-home --uid 10001 siaas \
    && mkdir -p /home/siaas/.cache/huggingface \
    && chown -R siaas:siaas /home/siaas/.cache
COPY services/laya/app.py .
COPY services/laya/LICENSE /service/LICENSE
USER siaas
ENV HF_HOME=/home/siaas/.cache/huggingface
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7821", "--workers", "1", "--no-access-log"]

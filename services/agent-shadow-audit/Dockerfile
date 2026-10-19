FROM python:3.13-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
USER nobody
CMD ["sh", "-c", "exec uvicorn --factory app.main:app_factory --host 0.0.0.0 --port ${PORT:-8080}"]

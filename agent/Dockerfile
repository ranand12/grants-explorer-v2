FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt asyncpg

COPY *.py ./

EXPOSE 8080
ENV PORT=8080
CMD ["python3", "agent.py"]

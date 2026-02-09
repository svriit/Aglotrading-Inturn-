FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

# Copy application
COPY . .

# Expose port
EXPOSE 5000

# Environment variables (override at runtime)
ENV FLASK_ENV=production
ENV SECRET_KEY=change-this-in-production

CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:5000", "app:app"]

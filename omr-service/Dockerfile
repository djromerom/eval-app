# Microservicio de detección OMR (Python + OpenCV headless + FastAPI).
# En producción corre como un servicio más de docker-compose, accesible solo
# desde la red interna del compose (nunca publicado al host ni proxyado por
# nginx). El worker OMR lo alcanza en http://omr-service:8000.
FROM python:3.11-slim

# libGL/libglib: dependencias nativas de opencv-contrib-python-headless.
# tesseract-ocr: lee el codigo impreso del bloque de identidad cuando el QR
# esta danado. Es opcional para el servicio (sin el, solo se pierde la
# sugerencia automatica), pero pesa poco y evita trabajo manual por hoja.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 tesseract-ocr \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Bind a 0.0.0.0 DENTRO del contenedor: el aislamiento lo da la red del
# compose (el puerto no se publica al host). 2 workers para procesar hojas
# en paralelo sin recargar OpenCV en cada request.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]

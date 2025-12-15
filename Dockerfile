# Use an official Python runtime as a parent image
FROM python:3.10-slim

# 1. Install system dependencies
# We specifically need FFmpeg for yt-dlp to merge audio/video and convert formats

# 2. Set the working directory
WORKDIR /app

# 3. Copy requirements and install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 4. Copy the rest of the application code
COPY . .

# 5. Create a directory for temporary downloads
RUN mkdir -p downloads

# 6. Expose the port
EXPOSE 8000

# 7. Run the application
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]

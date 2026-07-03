ARG BASE_IMAGE
FROM $BASE_IMAGE
WORKDIR /app

# Copy user's worker code on top of the base image
COPY . .

# Install user dependencies if package.json exists
RUN if [ -f package.json ]; then npm install; fi

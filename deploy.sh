#!/bin/bash
set -e

if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

IMAGE="ghcr.io/wmichelin/pantry:latest"

echo "Building $IMAGE for linux/arm64..."
docker buildx build \
  --platform linux/arm64 \
  --build-arg EXPO_PUBLIC_SUPABASE_URL="$EXPO_PUBLIC_SUPABASE_URL" \
  --build-arg EXPO_PUBLIC_SUPABASE_ANON_KEY="$EXPO_PUBLIC_SUPABASE_ANON_KEY" \
  -t "$IMAGE" \
  --push \
  .

echo "Deploying to Pi..."
ssh wmichelin@raspberrypi.local "echo '$GITHUB_TOKEN' | docker login ghcr.io -u wmichelin --password-stdin && cd ~/homelab && docker compose pull pantry && docker compose up -d pantry"

echo "Done! Pantry available at http://raspberrypi.local:8080"

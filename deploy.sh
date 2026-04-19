#!/bin/bash
# Requires GITHUB_TOKEN with GitHub Packages scopes: read:packages and write:packages
# (classic PAT). `gh auth token` alone often cannot pull private GHCR images (403).
set -e

if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

IMAGE="ghcr.io/wmichelin/pantry:latest"
DOMAIN="pantry.waltermichelin.com"

: "${GITHUB_TOKEN:?GITHUB_TOKEN is not set}"
DROPLET_IP=$(cd terraform && terraform output -raw droplet_ip)

echo "Building $IMAGE for linux/amd64..."
docker buildx build \
  --platform linux/amd64 \
  --build-arg EXPO_PUBLIC_SUPABASE_URL="$EXPO_PUBLIC_SUPABASE_URL" \
  --build-arg EXPO_PUBLIC_SUPABASE_ANON_KEY="$EXPO_PUBLIC_SUPABASE_ANON_KEY" \
  -t "$IMAGE" \
  --push \
  .

echo "Deploying to $DROPLET_IP..."
printf '%s\n' \
  '# Install Docker if missing' \
  'if ! command -v docker &>/dev/null; then' \
  '  apt-get update -y && apt-get install -y docker.io' \
  '  systemctl enable docker && systemctl start docker' \
  'fi' \
  '# Install nginx + certbot if missing' \
  'if ! command -v nginx &>/dev/null; then' \
  '  apt-get update -y && apt-get install -y nginx certbot python3-certbot-nginx' \
  'fi' \
  '# Pull and run app container on 8080' \
  "echo '${GITHUB_TOKEN}' | docker login ghcr.io -u wmichelin --password-stdin" \
  "docker pull ${IMAGE} || { echo 'docker pull failed — use a GitHub PAT with read:packages (see deploy.sh header).'; exit 1; }" \
  'docker rm -f pantry 2>/dev/null || true' \
  "docker run -d --name pantry --restart always -p 8080:80 ${IMAGE}" \
  '# Configure nginx reverse proxy' \
  "cat > /etc/nginx/sites-available/${DOMAIN} <<'NGINXCONF'" \
  "server {" \
  "    listen 80;" \
  "    server_name ${DOMAIN};" \
  "    location / {" \
  "        proxy_pass http://localhost:8080;" \
  "        proxy_set_header Host \$host;" \
  "        proxy_set_header X-Real-IP \$remote_addr;" \
  "    }" \
  "}" \
  'NGINXCONF' \
  "ln -sf /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/${DOMAIN}" \
  'rm -f /etc/nginx/sites-enabled/default' \
  'nginx -t && systemctl reload nginx' \
  '# Obtain or renew SSL cert' \
  "certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos -m wmichelin@gmail.com --redirect" \
  | ssh -o StrictHostKeyChecking=no root@"$DROPLET_IP" bash

echo "Done! Pantry available at https://$DOMAIN"

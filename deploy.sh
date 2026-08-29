#!/bin/bash
# Deploy from a Terraform + Docker-capable machine, including the G5/t3.code server.
# Requires GITHUB_TOKEN with GitHub Packages scopes: read:packages and write:packages.
set -e
set -u

if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

IMAGE="${IMAGE:-ghcr.io/wmichelin/pantry:latest}"
DOMAIN="${DOMAIN:-pantry.waltermichelin.com}"
SSH_USER="${SSH_USER:-root}"
SSH_PORT="${SSH_PORT:-22}"
SSH_OPTS=(-p "$SSH_PORT" -o StrictHostKeyChecking=accept-new)

: "${GITHUB_TOKEN:?GITHUB_TOKEN is not set}"
command -v terraform >/dev/null 2>&1 || {
  echo "Terraform is required. Run the G5 setup instructions in docs/DEPLOY.md." >&2
  exit 1
}
command -v docker >/dev/null 2>&1 || {
  echo "Docker is required. Install Docker on the G5 server before deploying." >&2
  exit 1
}

if [ -n "${DROPLET_HOST:-}" ]; then
  DEPLOY_HOST="$DROPLET_HOST"
else
  (cd terraform && terraform init -input=false >/dev/null)
  DEPLOY_HOST=$(cd terraform && terraform output -raw droplet_ip)
fi

echo "Building $IMAGE for linux/amd64..."
docker buildx build \
  --platform linux/amd64 \
  --build-arg EXPO_PUBLIC_SUPABASE_URL="$EXPO_PUBLIC_SUPABASE_URL" \
  --build-arg EXPO_PUBLIC_SUPABASE_ANON_KEY="$EXPO_PUBLIC_SUPABASE_ANON_KEY" \
  -t "$IMAGE" \
  --push \
  .

echo "Deploying to ${SSH_USER}@${DEPLOY_HOST}..."
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
  '# Nginx + TLS: first deploy writes HTTP + runs certbot; once certs exist, only reload nginx (do not overwrite HTTPS).' \
  "export DOMAIN=${DOMAIN}" \
  'if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then' \
  "  cat > /etc/nginx/sites-available/\$DOMAIN <<'NGINXCONF'" \
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
  '  ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN' \
  '  rm -f /etc/nginx/sites-enabled/default' \
  '  nginx -t && systemctl reload nginx' \
  "  certbot --nginx -d \$DOMAIN --non-interactive --agree-tos -m wmichelin@gmail.com --redirect" \
  'else' \
  '  nginx -t && systemctl reload nginx' \
  'fi' \
  | ssh "${SSH_OPTS[@]}" "${SSH_USER}@${DEPLOY_HOST}" bash

echo "Done! Pantry available at https://$DOMAIN"

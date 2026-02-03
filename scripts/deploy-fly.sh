#!/bin/bash
set -euo pipefail

echo "=== Battlebox Fly.io Deployment Script ==="

# Check if flyctl is installed
if ! command -v flyctl &> /dev/null; then
  echo "❌ flyctl is required but not installed."
  echo "Install it from: https://fly.io/docs/flyctl/"
  exit 1
fi

# Check if user is logged in to Fly.io
if ! flyctl auth whoami &> /dev/null; then
  echo "❌ Not logged in to Fly.io."
  echo "Run: flyctl auth login"
  exit 1
fi

APP_NAME=${1:-"battlebox"}
REGION=${2:-"sea"}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

if [ ! -f fly.toml ]; then
  echo "❌ fly.toml not found in repo root."
  exit 1
fi

echo "📝 Configuration:"
echo "   App Name: $APP_NAME"
echo "   Region: $REGION"
echo ""

echo "🧱 Building static data..."
./build.sh

# Check if app already exists or is available
if flyctl apps list | grep -q "$APP_NAME"; then
  echo "✅ App '$APP_NAME' already exists"
else
  echo "🔍 Checking if app name '$APP_NAME' is available..."
  if flyctl apps create "$APP_NAME" --generate-name=false 2>/dev/null; then
    echo "✅ Created new app '$APP_NAME'"
  else
    echo "❌ App name '$APP_NAME' is already taken by another user"
    echo "💡 Try a different name:"
    echo "   ./scripts/deploy-fly.sh your-name-battlebox"
    echo "   ./scripts/deploy-fly.sh battlebox-$(date +%m%d)"
    exit 1
  fi
fi

# Update fly.toml with correct app name and region
echo "📝 Updating fly.toml with app name..."
sed -i.bak "s/^app = .*/app = \"$APP_NAME\"/" fly.toml
sed -i.bak "s/^primary_region = .*/primary_region = \"$REGION\"/" fly.toml
rm fly.toml.bak

# Deploy the application
echo "🚀 Deploying to Fly.io..."
flyctl deploy --app "$APP_NAME"

# Check deployment status
echo ""
echo "📊 Deployment Status:"
flyctl status --app "$APP_NAME"

APP_URL="https://$APP_NAME.fly.dev"
echo ""
echo "✅ Deployment complete!"
echo "🌐 Your app is available at: $APP_URL"
echo ""
echo "💡 Useful commands:"
echo "   flyctl logs --app $APP_NAME"
echo "   flyctl status --app $APP_NAME"
echo "   flyctl apps restart --app $APP_NAME"

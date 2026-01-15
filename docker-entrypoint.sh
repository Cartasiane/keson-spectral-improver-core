#!/bin/sh
set -e

# Setup Tidal DL NG config
CONFIG_DIR="/root/.config/tidal_dl_ng"
mkdir -p "$CONFIG_DIR"

# 1. Environment Variables (Portainer friendly)
if [ -n "$TIDAL_TOKEN_JSON" ]; then
    echo "Found TIDAL_TOKEN_JSON environment variable, setting up configuration..."
    echo "$TIDAL_TOKEN_JSON" > "$CONFIG_DIR/token.json"
fi

# Always ensure settings.json has FFmpeg path
if [ -n "$TIDAL_SETTINGS_JSON" ]; then
    echo "Found TIDAL_SETTINGS_JSON environment variable, copying..."
    echo "$TIDAL_SETTINGS_JSON" > "$CONFIG_DIR/settings.json"
fi

# Create or update settings with FFmpeg path if missing
if [ -f "$CONFIG_DIR/settings.json" ]; then
    # Check if path_binary_ffmpeg is set
    if ! grep -q '"path_binary_ffmpeg"' "$CONFIG_DIR/settings.json" 2>/dev/null; then
        echo "Adding FFmpeg path to existing settings..."
        # Add ffmpeg path to existing JSON (simple sed approach)
        sed -i 's/}$/,"path_binary_ffmpeg":"\/usr\/bin\/ffmpeg"}/' "$CONFIG_DIR/settings.json"
    fi
else
    echo "Creating default tidal-dl-ng settings with FFmpeg path..."
    cat > "$CONFIG_DIR/settings.json" << 'EOF'
{
    "download_path": "/root/download",
    "quality_audio": "lossless",
    "quality_video": "high",
    "video_convert_mp4": true,
    "path_binary_ffmpeg": "/usr/bin/ffmpeg"
}
EOF
fi

# 2. Docker Secrets (Secure fallback)
if [ -f "/run/secrets/tidal_token" ] && [ ! -f "$CONFIG_DIR/token.json" ]; then
    echo "Found Tidal token secret, setting up configuration..."
    cp /run/secrets/tidal_token "$CONFIG_DIR/token.json"
fi

if [ -f "/run/secrets/tidal_settings" ] && [ ! -f "$CONFIG_DIR/settings.json" ]; then
    echo "Found Tidal settings secret, copying..."
    cp /run/secrets/tidal_settings "$CONFIG_DIR/settings.json"
fi

# Execute the main container command
exec "$@"

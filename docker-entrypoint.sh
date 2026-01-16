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

if [ -n "$TIDAL_SETTINGS_JSON" ]; then
    echo "Found TIDAL_SETTINGS_JSON environment variable, copying..."
    echo "$TIDAL_SETTINGS_JSON" > "$CONFIG_DIR/settings.json"
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

# 3. Ensure FFmpeg path is set in settings
# If no settings exist, create default
if [ ! -f "$CONFIG_DIR/settings.json" ]; then
    echo "Creating default tidal-dl-ng settings..."
    cat > "$CONFIG_DIR/settings.json" << 'EOF'
{
    "download_path": "/root/download",
    "quality_audio": "lossless",
    "quality_video": "high",
    "video_convert_mp4": true,
    "path_binary_ffmpeg": "/usr/bin/ffmpeg"
}
EOF
else
    # Ensure FFmpeg path is set using Node.js for reliable JSON handling
    echo "Ensuring FFmpeg path is set in tidal-dl-ng settings..."
    node -e "
const fs = require('fs');
const file = '$CONFIG_DIR/settings.json';
try {
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!settings.path_binary_ffmpeg) {
        settings.path_binary_ffmpeg = '/usr/bin/ffmpeg';
        fs.writeFileSync(file, JSON.stringify(settings, null, 4));
        console.log('Added FFmpeg path to settings');
    } else {
        console.log('FFmpeg path already set:', settings.path_binary_ffmpeg);
    }
} catch (e) {
    console.error('Failed to update settings:', e.message);
}
"
fi

# Execute the main container command
exec "$@"

#!/bin/bash
# NeuraTalk RunPod Setup Script
# Run ONCE after pod resume:
#   curl -sL <your-repo>/scripts/runpod-setup.sh | bash
# Or manually: bash /workspace/neuratalk/scripts/runpod-setup.sh

set -e

echo "=========================================="
echo "NeuraTalk RunPod Setup"
echo "=========================================="

cd /workspace

# 1. Install Docker + Compose (if missing)
if ! command -v docker &> /dev/null; then
  echo "[1/5] Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  apt-get install -y docker-compose-plugin
fi

# 2. Install NVIDIA container toolkit (for GPU passthrough)
echo "[2/5] Configuring NVIDIA runtime..."
if ! docker info | grep -q nvidia; then
  distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
  curl -s -L https://nvidia.github.io/libnvidia-container/gpgkey | apt-key add -
  curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
  apt-get update && apt-get install -y nvidia-container-toolkit
  nvidia-ctk runtime configure --runtime=docker
  systemctl restart docker
fi

# 3. Download Piper voice models
echo "[3/5] Downloading Piper voices..."
mkdir -p /workspace/piper-voices
cd /workspace/piper-voices
for voice in en_US-amy-medium hi_IN-priyamvada-medium te_IN-amrutha-medium; do
  if [ ! -f "${voice}.onnx" ]; then
    wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/main/${voice%%_*}/${voice%-*}/${voice}.onnx" || echo "  [warn] ${voice} skipped"
    wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/main/${voice%%_*}/${voice%-*}/${voice}.onnx.json" || true
  fi
done

# 4. Clone backend (or pull latest)
echo "[4/5] Backend code..."
cd /workspace
if [ ! -d "neuratalk" ]; then
  echo "  First time — clone your repo:"
  echo "  git clone <your-repo-url> /workspace/neuratalk"
  echo "  (Do this manually, then re-run setup)"
else
  cd neuratalk && git pull
fi

# 5. Start all services
echo "[5/5] Starting Docker Compose..."
cd /workspace/neuratalk
docker compose -f docker-compose.runpod.yml up -d

echo ""
echo "=========================================="
echo "SETUP COMPLETE"
echo "=========================================="
echo "Services:"
echo "  LiveKit:        http://<pod-ip>:7880"
echo "  Whisper:        http://<pod-ip>:8080"
echo "  LibreTranslate: http://<pod-ip>:8081"
echo "  Piper TTS:      http://<pod-ip>:8083"
echo "  Backend API:    http://<pod-ip>:3000"
echo ""
echo "Check health:  docker compose ps"
echo "View logs:     docker compose logs -f"
echo "=========================================="

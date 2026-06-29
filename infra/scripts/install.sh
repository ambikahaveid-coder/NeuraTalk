#!/usr/bin/env bash
##############################################################################
# NeuraTalk SIP Core — Ubuntu 24.04 Automated Installer
#
# Installs and configures:
#   - Kamailio 5.8 (SIP core, SBC, LCR, registrar)
#   - RTPEngine (RTP proxy, media fork, SRTP bridge)
#   - Certbot (TLS certificate management)
#   - Fail2ban (SIP brute-force protection)
#   - UFW firewall rules
#   - Prometheus node exporter
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/NeuraTalk/infra/main/scripts/install.sh | sudo bash
#   OR
#   sudo bash infra/scripts/install.sh
#
# Environment (export before running or pass inline):
#   KAMAILIO_DOMAIN=sip.neuratalk.in
#   PUBLIC_IP=1.2.3.4
#   PRIVATE_IP=10.0.0.2      (optional — defaults to PUBLIC_IP)
#   NEURATALK_API_HOST=app.neuratalk.in
#   ADMIN_EMAIL=ops@neuratalk.in
#   INSTALL_FREESWITCH=false  (set to true to install FreeSWITCH)
##############################################################################

set -euo pipefail

##############################################################################
# CONFIGURATION
##############################################################################

KAMAILIO_VERSION="5.8"
RTPENGINE_VERSION="mr11.5"

KAMAILIO_DOMAIN="${KAMAILIO_DOMAIN:-sip.neuratalk.in}"
PUBLIC_IP="${PUBLIC_IP:-$(curl -sf https://ipecho.net/plain || hostname -I | awk '{print $1}')}"
PRIVATE_IP="${PRIVATE_IP:-$PUBLIC_IP}"
NEURATALK_API_HOST="${NEURATALK_API_HOST:-app.neuratalk.in}"
ADMIN_EMAIL="${ADMIN_EMAIL:-ops@neuratalk.in}"
INSTALL_FREESWITCH="${INSTALL_FREESWITCH:-false}"

LOG_FILE="/var/log/neuratalk-install.log"
KAMAILIO_CFG_DIR="/etc/kamailio"
RTPENGINE_CFG_DIR="/etc/rtpengine"
INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GRN}[$(date '+%H:%M:%S')] $*${NC}" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YLW}[WARN] $*${NC}" | tee -a "$LOG_FILE"; }
err()  { echo -e "${RED}[ERR]  $*${NC}" | tee -a "$LOG_FILE"; exit 1; }

##############################################################################
# PREFLIGHT
##############################################################################

preflight() {
    log "=== NeuraTalk SIP Core Installer ==="
    log "Domain:  $KAMAILIO_DOMAIN"
    log "Public:  $PUBLIC_IP"
    log "Private: $PRIVATE_IP"
    log "API:     $NEURATALK_API_HOST"

    [[ "$(id -u)" == "0" ]] || err "Must run as root (sudo bash install.sh)"

    # Ubuntu 24.04 check
    . /etc/os-release
    [[ "$ID" == "ubuntu" ]] || warn "Not Ubuntu — proceed with caution"
    [[ "${VERSION_ID:-}" =~ ^(22|24) ]] || warn "Tested on Ubuntu 22/24 only"

    # Check DNS
    if ! host "$KAMAILIO_DOMAIN" >/dev/null 2>&1; then
        warn "$KAMAILIO_DOMAIN does not resolve — TLS cert provisioning will fail"
        warn "Continue anyway? (ctrl-C to abort, Enter to continue)"
        read -r
    fi
}

##############################################################################
# SYSTEM PACKAGES
##############################################################################

system_packages() {
    log "Installing system dependencies..."
    export DEBIAN_FRONTEND=noninteractive

    apt-get update -qq
    apt-get install -y --no-install-recommends \
        curl wget gnupg2 lsb-release ca-certificates \
        apt-transport-https software-properties-common \
        git build-essential pkg-config \
        certbot \
        fail2ban \
        ufw \
        sngrep \
        tcpdump \
        jq \
        nload \
        prometheus-node-exporter

    log "System packages installed"
}

##############################################################################
# KAMAILIO 5.8
##############################################################################

install_kamailio() {
    log "Adding Kamailio 5.8 repository..."

    # Official Kamailio apt repo
    curl -sSL https://deb.kamailio.org/kamailiodebkey.gpg \
        | gpg --dearmor -o /usr/share/keyrings/kamailio-archive-keyring.gpg

    DISTRO=$(lsb_release -cs)
    cat > /etc/apt/sources.list.d/kamailio.list <<EOF
deb [signed-by=/usr/share/keyrings/kamailio-archive-keyring.gpg] http://deb.kamailio.org/kamailio${KAMAILIO_VERSION} ${DISTRO} main
deb-src [signed-by=/usr/share/keyrings/kamailio-archive-keyring.gpg] http://deb.kamailio.org/kamailio${KAMAILIO_VERSION} ${DISTRO} main
EOF

    apt-get update -qq

    log "Installing Kamailio 5.8 and modules..."
    apt-get install -y \
        kamailio \
        kamailio-tls-modules \
        kamailio-websocket-modules \
        kamailio-json-modules \
        kamailio-utils-modules \
        kamailio-extra-modules \
        kamailio-autheph-modules \
        kamailio-kazoo-modules \
        kamailio-mysql-modules \
        kamailio-postgres-modules \
        kamailio-redis-modules \
        kamailio-http-async-client-modules \
        kamailio-phonenum-modules \
        kamailio-snmpstats-modules

    log "Kamailio $(kamailio -v 2>&1 | head -1 | awk '{print $3}') installed"
}

##############################################################################
# RTPENGINE
##############################################################################

install_rtpengine() {
    log "Installing RTPEngine..."

    # Add RTPEngine apt repo (Sipwise/NGCP)
    curl -sSL https://deb.sipwise.com/spce/sipwise-keyring.gpg \
        | gpg --dearmor -o /usr/share/keyrings/sipwise-archive-keyring.gpg

    DISTRO=$(lsb_release -cs)
    cat > /etc/apt/sources.list.d/sipwise.list <<EOF
deb [signed-by=/usr/share/keyrings/sipwise-archive-keyring.gpg] http://deb.sipwise.com/spce/ ${DISTRO} main
EOF

    apt-get update -qq
    apt-get install -y rtpengine

    # Create directories
    mkdir -p /var/run/rtpengine /var/lib/rtpengine/recordings
    chown rtpengine:rtpengine /var/run/rtpengine /var/lib/rtpengine/recordings 2>/dev/null || true

    log "RTPEngine installed"
}

##############################################################################
# FREESWITCH (optional)
##############################################################################

install_freeswitch() {
    if [[ "$INSTALL_FREESWITCH" != "true" ]]; then
        log "Skipping FreeSWITCH (INSTALL_FREESWITCH!=true)"
        return
    fi

    log "Installing FreeSWITCH..."

    curl -sSL https://files.freeswitch.org/repo/deb/debian-release/fsstretch-archive-keyring.asc \
        | gpg --dearmor -o /usr/share/keyrings/freeswitch-archive-keyring.gpg

    DISTRO=$(lsb_release -cs)
    echo "deb [signed-by=/usr/share/keyrings/freeswitch-archive-keyring.gpg] https://files.freeswitch.org/repo/deb/debian-release/ ${DISTRO} main" \
        > /etc/apt/sources.list.d/freeswitch.list

    apt-get update -qq
    apt-get install -y \
        freeswitch \
        freeswitch-mod-sofia \
        freeswitch-mod-event-socket \
        freeswitch-mod-commands \
        freeswitch-mod-dptools \
        freeswitch-mod-dialplan-xml \
        freeswitch-mod-loopback \
        freeswitch-mod-g711 \
        freeswitch-mod-opus \
        freeswitch-mod-local-stream \
        freeswitch-mod-tone-stream \
        freeswitch-mod-say-en

    log "FreeSWITCH installed"
}

##############################################################################
# CONFIGURATION FILES
##############################################################################

configure_kamailio() {
    log "Configuring Kamailio..."

    mkdir -p "$KAMAILIO_CFG_DIR/tls"

    # Copy config files from infra directory
    if [[ -d "$INFRA_DIR/kamailio" ]]; then
        cp "$INFRA_DIR/kamailio/kamailio.cfg"    "$KAMAILIO_CFG_DIR/"
        cp "$INFRA_DIR/kamailio/tls.cfg"         "$KAMAILIO_CFG_DIR/"
        cp "$INFRA_DIR/kamailio/dispatcher.list" "$KAMAILIO_CFG_DIR/"
        cp "$INFRA_DIR/kamailio/kamctlrc"        "$KAMAILIO_CFG_DIR/"
        log "Config files copied from $INFRA_DIR/kamailio/"
    else
        warn "infra/kamailio/ not found — manually place config files in $KAMAILIO_CFG_DIR"
    fi

    # Create runtime directories
    mkdir -p /var/run/kamailio
    chown kamailio:kamailio /var/run/kamailio 2>/dev/null || true

    # Write environment file for systemd
    cat > /etc/default/kamailio <<EOF
# NeuraTalk Kamailio environment
KAMAILIO_DOMAIN=${KAMAILIO_DOMAIN}
KAMAILIO_PUBLIC_IP=${PUBLIC_IP}
KAMAILIO_PRIVATE_IP=${PRIVATE_IP}
RTPENGINE_HOST=127.0.0.1:22222
FREESWITCH_HOST=127.0.0.1
FREESWITCH_PORT=5080
NEURATALK_API_HOST=${NEURATALK_API_HOST}
KAMAILIO_LOG_LEVEL=3
EOF

    log "Kamailio configured"
}

configure_rtpengine() {
    log "Configuring RTPEngine..."

    mkdir -p "$RTPENGINE_CFG_DIR"

    if [[ -f "$INFRA_DIR/rtpengine/rtpengine.conf" ]]; then
        # Substitute env vars in the config template
        PRIVATE_IP="$PRIVATE_IP" PUBLIC_IP="$PUBLIC_IP" \
            envsubst < "$INFRA_DIR/rtpengine/rtpengine.conf" \
            > "$RTPENGINE_CFG_DIR/rtpengine.conf"
        log "RTPEngine config written to $RTPENGINE_CFG_DIR/rtpengine.conf"
    else
        cat > "$RTPENGINE_CFG_DIR/rtpengine.conf" <<EOF
[rtpengine]
interface = ${PRIVATE_IP}!${PUBLIC_IP}
listen-ng = 127.0.0.1:22222
listen-http = 127.0.0.1:8088
listen-prometheus = 127.0.0.1:9309
port-min = 30000
port-max = 40000
log-level = 4
log-facility = daemon
no-fallback = false
timeout = 60
silent-timeout = 3600
final-timeout = 10800
EOF
    fi

    # Write environment file
    cat > /etc/default/rtpengine <<EOF
RTPENGINE_ARGS="--config-file=/etc/rtpengine/rtpengine.conf"
EOF
}

##############################################################################
# TLS CERTIFICATES
##############################################################################

provision_tls() {
    log "Provisioning TLS certificates via Let's Encrypt..."

    # Stop Kamailio/nginx if running to free port 80
    systemctl stop kamailio 2>/dev/null || true
    systemctl stop nginx 2>/dev/null || true

    certbot certonly \
        --standalone \
        --agree-tos \
        --non-interactive \
        --email "$ADMIN_EMAIL" \
        -d "$KAMAILIO_DOMAIN" || {
            warn "Certbot failed — will use self-signed cert for now"
            generate_self_signed_cert
            return
        }

    # Link into Kamailio TLS dir
    CERT_DIR="/etc/letsencrypt/live/$KAMAILIO_DOMAIN"
    ln -sf "$CERT_DIR/fullchain.pem" "$KAMAILIO_CFG_DIR/tls/cert.pem"
    ln -sf "$CERT_DIR/privkey.pem"   "$KAMAILIO_CFG_DIR/tls/key.pem"
    ln -sf "$CERT_DIR/chain.pem"     "$KAMAILIO_CFG_DIR/tls/ca.pem"

    # Auto-renewal hook — restart Kamailio when cert renews
    cat > /etc/letsencrypt/renewal-hooks/post/kamailio.sh <<'HOOK'
#!/bin/bash
systemctl reload kamailio
HOOK
    chmod +x /etc/letsencrypt/renewal-hooks/post/kamailio.sh

    log "TLS certificate provisioned"
}

generate_self_signed_cert() {
    warn "Generating self-signed certificate (development only)"
    openssl req -new -x509 -days 365 -nodes \
        -subj "/CN=$KAMAILIO_DOMAIN/O=NeuraTalk/C=IN" \
        -out "$KAMAILIO_CFG_DIR/tls/cert.pem" \
        -keyout "$KAMAILIO_CFG_DIR/tls/key.pem"
    cp "$KAMAILIO_CFG_DIR/tls/cert.pem" "$KAMAILIO_CFG_DIR/tls/ca.pem"
    chmod 600 "$KAMAILIO_CFG_DIR/tls/key.pem"
    warn "Replace self-signed cert with Let's Encrypt before production!"
}

##############################################################################
# FIREWALL
##############################################################################

configure_firewall() {
    log "Configuring UFW firewall..."

    # Enable UFW
    ufw --force reset
    ufw default deny incoming
    ufw default allow outgoing

    # SSH — must allow first or you'll lock yourself out
    ufw allow 22/tcp comment "SSH"

    # SIP signaling
    ufw allow 5060/udp comment "SIP UDP"
    ufw allow 5060/tcp comment "SIP TCP"
    ufw allow 5061/tcp comment "SIP TLS"

    # WebSocket SIP (for browser clients)
    ufw allow 8443/tcp comment "SIP WebSocket TLS"

    # RTP media (must match port range in rtpengine.conf)
    ufw allow 30000:40000/udp comment "RTP Media"

    # HTTP for health checks (restrict to monitoring systems in production)
    ufw allow 80/tcp comment "HTTP (ACME/LetsEncrypt)"
    ufw allow 443/tcp comment "HTTPS"

    # Internal-only ports — DO NOT expose to public
    # MI HTTP, Prometheus exporters, Grafana:
    # These are served only on localhost or internal network

    ufw --force enable

    log "Firewall configured (SIP:5060/5061, RTP:30000-40000, SSH:22)"
}

##############################################################################
# FAIL2BAN — SIP brute-force protection
##############################################################################

configure_fail2ban() {
    log "Configuring Fail2ban for SIP protection..."

    cat > /etc/fail2ban/jail.d/kamailio.conf <<'EOF'
[kamailio]
enabled  = true
port     = 5060
protocol = udp
filter   = kamailio
logpath  = /var/log/kamailio/kamailio.log
maxretry = 5
findtime = 300
bantime  = 3600
action   = ufw

[kamailio-tcp]
enabled  = true
port     = 5060
protocol = tcp
filter   = kamailio
logpath  = /var/log/kamailio/kamailio.log
maxretry = 5
findtime = 300
bantime  = 3600
EOF

    cat > /etc/fail2ban/filter.d/kamailio.conf <<'EOF'
[Definition]
_daemon = kamailio
failregex = ^\[\w+\] .* BLOCKED: .* <HOST>
            ^\[\w+\] .* FLOOD: Banning <HOST>
            ^\[\w+\] WARNING: .*: hash_table_db: failed to authenticate <HOST>
ignoreregex =
EOF

    systemctl restart fail2ban
    log "Fail2ban configured"
}

##############################################################################
# SYSTEMD SERVICES
##############################################################################

configure_systemd() {
    log "Configuring systemd services..."

    # Copy service files if they exist in infra
    if [[ -f "$INFRA_DIR/systemd/kamailio.service" ]]; then
        cp "$INFRA_DIR/systemd/kamailio.service" /etc/systemd/system/
    fi
    if [[ -f "$INFRA_DIR/systemd/rtpengine.service" ]]; then
        cp "$INFRA_DIR/systemd/rtpengine.service" /etc/systemd/system/
    fi

    systemctl daemon-reload

    # Enable and start services
    systemctl enable rtpengine kamailio
    systemctl start rtpengine

    # Give RTPEngine a moment to bind its ports before Kamailio starts
    sleep 2
    systemctl start kamailio

    log "Services started"
}

##############################################################################
# VALIDATION
##############################################################################

validate_installation() {
    log "=== Validating Installation ==="

    # Kamailio process
    if systemctl is-active --quiet kamailio; then
        log "✓ Kamailio is running"
    else
        err "✗ Kamailio failed to start — check: journalctl -u kamailio"
    fi

    # RTPEngine process
    if systemctl is-active --quiet rtpengine; then
        log "✓ RTPEngine is running"
    else
        warn "✗ RTPEngine is not running"
    fi

    # MI HTTP
    if curl -sf "http://127.0.0.1:8080/mi/core.uptime" >/dev/null 2>&1; then
        log "✓ Kamailio MI HTTP responding"
    else
        warn "✗ MI HTTP not responding (check port 8080)"
    fi

    # RTPEngine ng
    if command -v rtpengine-ctl &>/dev/null; then
        if rtpengine-ctl --ng-address=127.0.0.1:22222 ping 2>/dev/null | grep -q pong; then
            log "✓ RTPEngine ng protocol responding"
        else
            warn "✗ RTPEngine ng not responding"
        fi
    fi

    # SIP port
    if ss -uln | grep -q ":5060"; then
        log "✓ SIP UDP port 5060 is open"
    else
        warn "✗ SIP UDP port 5060 not bound"
    fi

    # Dispatcher list loaded
    DISPATCHER_COUNT=$(curl -sf "http://127.0.0.1:8080/mi/dispatcher.list" 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d.get('RECORDS',[])))" 2>/dev/null || echo "?")
    log "✓ Dispatcher: $DISPATCHER_COUNT provider groups loaded"

    log "=== Installation Complete ==="
    log ""
    log "Next steps:"
    log "  1. Edit /etc/kamailio/dispatcher.list with real carrier SIP URIs"
    log "  2. Run: kamctl dispatcher reload"
    log "  3. Test SIP registration: sipsak -s sip:test@$KAMAILIO_DOMAIN"
    log "  4. Run: bash infra/scripts/health-check.sh"
    log ""
    log "Kamailio MI: http://127.0.0.1:8080/mi"
    log "RTPEngine:   http://127.0.0.1:8088"
    log "Prometheus:  http://127.0.0.1:9090"
}

##############################################################################
# MAIN
##############################################################################

main() {
    mkdir -p "$(dirname "$LOG_FILE")"
    touch "$LOG_FILE"

    preflight
    system_packages
    install_kamailio
    install_rtpengine
    install_freeswitch
    configure_kamailio
    configure_rtpengine
    provision_tls
    configure_firewall
    configure_fail2ban
    configure_systemd
    validate_installation
}

main "$@"

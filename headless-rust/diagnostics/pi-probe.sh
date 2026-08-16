#!/usr/bin/env bash
# ==============================================================================
# Speedcamera Pi-Side Hardware, Kernel, Wi-Fi & Socket Diagnostics Probe
# Outputs a single structured JSON payload on stdout.
# ==============================================================================

set -o pipefail 2>/dev/null || true

TIMESTAMP=$(date +%s%3N 2>/dev/null || date +%s)
WIFI_IFACE=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^(wlan|wifi|wlp)' | head -n 1 || echo "wlan0")
ETH_IFACE=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^(eth|end|enp)' | head -n 1 || echo "eth0")

# --- 1. Wi-Fi Power Save & Station Link Status ---
WIFI_POWER_SAVE="unknown"
if command -v iw &>/dev/null; then
  WIFI_POWER_SAVE=$(iw dev "${WIFI_IFACE}" get power_save 2>/dev/null | awk '{print $NF}' || echo "unknown")
elif command -v iwconfig &>/dev/null; then
  WIFI_POWER_SAVE=$(iwconfig "${WIFI_IFACE}" 2>/dev/null | grep -i "power management" | awk -F':' '{print $2}' | tr -d ' ' || echo "unknown")
fi

STATION_DUMP_RAW=""
if command -v iw &>/dev/null; then
  STATION_DUMP_RAW=$(iw dev "${WIFI_IFACE}" station dump 2>/dev/null || true)
fi

CLIENT_MAC=$(echo "$STATION_DUMP_RAW" | grep -i "^Station" | head -n 1 | awk '{print $2}' || echo "")
INACTIVE_TIME_MS=$(echo "$STATION_DUMP_RAW" | grep -i "inactive time" | head -n 1 | awk '{print $3}' || echo "0")
SIGNAL_DBM=$(echo "$STATION_DUMP_RAW" | grep -i "signal:" | head -n 1 | awk '{print $2}' || echo "0")
TX_RETRIES=$(echo "$STATION_DUMP_RAW" | grep -i "tx retries:" | head -n 1 | awk '{print $3}' || echo "0")
TX_FAILED=$(echo "$STATION_DUMP_RAW" | grep -i "tx failed:" | head -n 1 | awk '{print $3}' || echo "0")
TX_BITRATE=$(echo "$STATION_DUMP_RAW" | grep -i "tx bitrate:" | head -n 1 | sed 's/.*tx bitrate:[ \t]*//' | tr -d '"' || echo "unknown")
RX_BITRATE=$(echo "$STATION_DUMP_RAW" | grep -i "rx bitrate:" | head -n 1 | sed 's/.*rx bitrate:[ \t]*//' | tr -d '"' || echo "unknown")
AUTHORIZED=$(echo "$STATION_DUMP_RAW" | grep -i "authorized:" | head -n 1 | awk '{print $2}' || echo "unknown")
AUTHENTICATED=$(echo "$STATION_DUMP_RAW" | grep -i "authenticated:" | head -n 1 | awk '{print $2}' || echo "unknown")

# --- 2. TCP Sockets & Queues ---
TCP_SOCKETS="[]"
if command -v ss &>/dev/null; then
  # Grab sockets on web port 3000 and ssh port 22
  TCP_SOCKETS=$(ss -t -i -a -n 2>/dev/null | awk '
    BEGIN { printf "[" ; first=1 }
    /ESTAB/ || /LISTEN/ {
      state=$1; recvq=$2; sendq=$3; local=$4; peer=$5;
      getline info;
      if (!first) { printf "," }
      first=0;
      gsub(/"/, "\\\"", info);
      printf "{\"state\":\"%s\",\"recv_q\":%s,\"send_q\":%s,\"local\":\"%s\",\"peer\":\"%s\",\"info\":\"%s\"}", state, recvq, sendq, local, peer, info;
    }
    END { printf "]" }
  ' || echo "[]")
fi

# --- 3. Kernel Sysctl Parameters ---
RMEM_DEFAULT=$(cat /proc/sys/net/core/rmem_default 2>/dev/null || echo "0")
WMEM_DEFAULT=$(cat /proc/sys/net/core/wmem_default 2>/dev/null || echo "0")
RMEM_MAX=$(cat /proc/sys/net/core/rmem_max 2>/dev/null || echo "0")
WMEM_MAX=$(cat /proc/sys/net/core/wmem_max 2>/dev/null || echo "0")
TCP_CONGESTION=$(cat /proc/sys/net/ipv4/tcp_congestion_control 2>/dev/null || echo "unknown")
NETDEV_MAX_BACKLOG=$(cat /proc/sys/net/core/netdev_max_backlog 2>/dev/null || echo "0")

# --- 4. Memory & Storage Dirty Page Writeback ---
MEM_DIRTY_KB=$(grep -i "^Dirty:" /proc/meminfo 2>/dev/null | awk '{print $2}' || echo "0")
MEM_WRITEBACK_KB=$(grep -i "^Writeback:" /proc/meminfo 2>/dev/null | awk '{print $2}' || echo "0")
MEM_AVAILABLE_KB=$(grep -i "^MemAvailable:" /proc/meminfo 2>/dev/null | awk '{print $2}' || echo "0")
MEM_TOTAL_KB=$(grep -i "^MemTotal:" /proc/meminfo 2>/dev/null | awk '{print $2}' || echo "0")

# D-state (Uninterruptible disk sleep processes)
D_STATE_COUNT=$(ps -eo state 2>/dev/null | grep -c "D" || echo "0")

# --- 5. SoftIRQs & CPU Interrupt Distribution ---
NET_RX_SOFTIRQS="[]"
if [ -f /proc/softirqs ]; then
  NET_RX_SOFTIRQS=$(grep "NET_RX:" /proc/softirqs | awk '{printf "["; for(i=2;i<=NF;i++){printf "%s%s", $i, (i<NF?",":"")}; printf "]"}' || echo "[]")
fi

# --- 6. Hardware Temperature & Throttling (Raspberry Pi specific) ---
THROTTLED_HEX="0x0"
TEMP_C="0"
ARM_FREQ_MHZ="0"
if command -v vcgencmd &>/dev/null; then
  THROTTLED_HEX=$(vcgencmd get_throttled 2>/dev/null | awk -F'=' '{print $2}' || echo "0x0")
  TEMP_C=$(vcgencmd measure_temp 2>/dev/null | sed -e 's/temp=//' -e "s/'C//" || echo "0")
  ARM_FREQ_MHZ=$(vcgencmd measure_clock arm 2>/dev/null | awk -F'=' '{print int($2/1000000)}' || echo "0")
fi

# --- 7. Speedcamera Service Status ---
SPEEDCAMERA_PID=$(pgrep -f "speedcamera" 2>/dev/null | head -n 1 || echo "0")
SPEEDCAMERA_CPU=$(ps -p "$SPEEDCAMERA_PID" -o %cpu= 2>/dev/null | tr -d ' ' || echo "0")
SPEEDCAMERA_MEM_KB=$(ps -p "$SPEEDCAMERA_PID" -o rss= 2>/dev/null | tr -d ' ' || echo "0")

# --- 8. Recent Kernel dmesg warnings related to Wi-Fi / brcmfmac ---
DMESG_SNIPPET=$(dmesg 2>/dev/null | grep -iE 'brcm|wlan|wifi|timeout|drop|failed' | tail -n 5 | sed 's/"/\\"/g' | tr '\n' ';' || echo "")

# --- Construct Final JSON ---
cat <<EOF
{
  "timestamp": ${TIMESTAMP},
  "wifi": {
    "interface": "${WIFI_IFACE}",
    "power_save": "${WIFI_POWER_SAVE}",
    "client_mac": "${CLIENT_MAC}",
    "inactive_time_ms": ${INACTIVE_TIME_MS:-0},
    "signal_dbm": ${SIGNAL_DBM:-0},
    "tx_retries": ${TX_RETRIES:-0},
    "tx_failed": ${TX_FAILED:-0},
    "tx_bitrate": "${TX_BITRATE}",
    "rx_bitrate": "${RX_BITRATE}",
    "authorized": "${AUTHORIZED}",
    "authenticated": "${AUTHENTICATED}"
  },
  "sysctl": {
    "rmem_default": ${RMEM_DEFAULT:-0},
    "wmem_default": ${WMEM_DEFAULT:-0},
    "rmem_max": ${RMEM_MAX:-0},
    "wmem_max": ${WMEM_MAX:-0},
    "tcp_congestion_control": "${TCP_CONGESTION}",
    "netdev_max_backlog": ${NETDEV_MAX_BACKLOG:-0}
  },
  "memory": {
    "dirty_kb": ${MEM_DIRTY_KB:-0},
    "writeback_kb": ${MEM_WRITEBACK_KB:-0},
    "available_kb": ${MEM_AVAILABLE_KB:-0},
    "total_kb": ${MEM_TOTAL_KB:-0},
    "d_state_processes": ${D_STATE_COUNT:-0}
  },
  "hardware": {
    "temp_c": "${TEMP_C}",
    "throttled_hex": "${THROTTLED_HEX}",
    "arm_freq_mhz": ${ARM_FREQ_MHZ:-0}
  },
  "softirqs": {
    "net_rx_per_cpu": ${NET_RX_SOFTIRQS:-[]}
  },
  "service": {
    "pid": ${SPEEDCAMERA_PID:-0},
    "cpu_percent": "${SPEEDCAMERA_CPU}",
    "rss_kb": ${SPEEDCAMERA_MEM_KB:-0}
  },
  "tcp_sockets": ${TCP_SOCKETS:-[]},
  "dmesg_snippet": "${DMESG_SNIPPET}"
}
EOF

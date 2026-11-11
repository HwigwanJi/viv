#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != Darwin ]]; then
  printf '%s\n' 'Use scripts/install-viv.ps1 on Windows.' >&2
  exit 1
fi

target=
recovery=
client=codex
port=4317
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mobile-only) recovery=mobile-only; shift ;;
    --target|--client|--port)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      case "$1" in
        --target) target="$2" ;;
        --client) client="$2" ;;
        --port) port="$2" ;;
      esac
      shift 2 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done
if [[ "$recovery" == mobile-only ]]; then
  if [[ -n "$target" && "$target" != mobile ]]; then
    printf '%s\n' 'Use --mobile-only with the mobile target.' >&2
    exit 2
  fi
  if [[ ! -f .runtime/self-host-id || ! -f .runtime/self-host.sqlite ]]; then
    printf '%s\n' 'Complete the PC installation in this folder before running mobile recovery.' >&2
    exit 1
  fi
  target=mobile
fi
if [[ -z "$target" ]]; then
  printf '%s\n' 'VIV를 어느 환경에서 사용하실 건가요?' '1. Mac만' '2. Mac과 모바일 (Tailscale 로그인 필요)' '0. 취소'
  read -r answer
  case "$answer" in
    1) target=pc ;;
    2) target=mobile ;;
    0) exit 0 ;;
    *) printf '%s\n' '1, 2 또는 0을 선택해 주세요.' >&2; exit 2 ;;
  esac
fi
case "$target" in pc|mobile) ;; *) printf '%s\n' 'Use --target pc or mobile.' >&2; exit 2 ;; esac
case "$client" in codex|claude|manual) ;; *) printf '%s\n' 'Use --client codex, claude, or manual.' >&2; exit 2 ;; esac
if [[ ! "$port" =~ ^[1-9][0-9]{3,4}$ ]] || (( port < 1024 || port > 65535 || port == 4905 )); then
  printf '%s\n' 'Choose a port from 1024 to 65535, excluding 4905.' >&2
  exit 2
fi

node_ready() {
  command -v node >/dev/null && command -v npm >/dev/null &&
    node --disable-warning=ExperimentalWarning -e "require('node:sqlite');if(+process.versions.node.split('.')[0]<24)process.exit(1)" 2>/dev/null
}
if ! node_ready; then
  umask 077
  mkdir -p .runtime
  case "$(uname -m)" in
    arm64) arch=arm64; checksum=aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a ;;
    x86_64) arch=x64; checksum=d5e336d588c45be0c37dbd52cc29895593009ca4997a77a1fd02815131ed0e52 ;;
    *) printf '%s\n' 'VIV requires an Apple Silicon or Intel Mac.' >&2; exit 1 ;;
  esac
  release="node-v24.22.2-darwin-$arch"
  node_root="$PWD/.runtime/$release"
  if [[ ! -x "$node_root/bin/node" ]]; then
    staging="$(mktemp -d "$PWD/.runtime/node-download.XXXXXX")"
    trap 'rm -f "$staging/node.tar.gz"' EXIT
    curl --fail --silent --show-error --location --retry 2 --proto '=https' \
      "https://nodejs.org/dist/v24.22.2/$release.tar.gz" -o "$staging/node.tar.gz"
    printf '%s  %s\n' "$checksum" "$staging/node.tar.gz" | shasum -a 256 -c - >&2
    tar -xzf "$staging/node.tar.gz" -C "$staging"
    if ! mv -n "$staging/$release" "$PWD/.runtime" || [[ ! -x "$node_root/bin/node" ]]; then
      printf '%s\n' 'Could not install the local Node.js runtime.' >&2
      exit 1
    fi
    rm -f "$staging/node.tar.gz"
    rmdir "$staging" 2>/dev/null || true
    trap - EXIT
  fi
  export PATH="$node_root/bin:$PATH"
fi
exec node scripts/setup-self-host-mac.mjs "$target" "$client" "$port" "$recovery"

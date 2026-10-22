#!/usr/bin/env bash
set -euo pipefail
fail() { printf 'SIAAS: %s\n' "$*" >&2; exit 1; }
for tool in curl tar unzip; do command -v "$tool" >/dev/null || fail "Install $tool using your operating system package manager, then retry."; done
if command -v sha256sum >/dev/null; then hash() { sha256sum "$1" | cut -d ' ' -f1; }; elif command -v shasum >/dev/null; then hash() { shasum -a 256 "$1" | cut -d ' ' -f1; }; else fail 'SHA-256 verification requires sha256sum or shasum.'; fi
case "$(uname -s)" in Darwin) platform=darwin;; Linux) platform=linux;; *) fail 'Use install.ps1 on Windows.';; esac
case "$(uname -m)" in x86_64|amd64) arch=x64;; arm64|aarch64) arch=arm64;; *) fail 'Supported architectures: x64 and arm64.';; esac
if [[ "$platform" == darwin && "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" == 1 ]]; then arch=arm64; fi
install_root="${SIAAS_INSTALL_DIR:-$HOME/.local/share/siaas-personal-source}"
case "$install_root" in /*) ;; *) fail 'SIAAS_INSTALL_DIR must be an absolute path.';; esac
stage="$(mktemp -d)"; trap 'rm -rf "$stage"' EXIT
get() { curl --fail --show-error --silent --location --proto '=https' --proto-redir '=https' --tlsv1.2 --max-redirs 5 --connect-timeout 20 --max-time 180 "$1" -o "$2"; }
printf 'Checking the public SIAAS Personal release…\n'
get "https://siaas.vercel.app/api/downloads?platform=$platform&arch=$arch&format=tsv" "$stage/manifest.tsv" || fail 'No downloadable public release is available, or the network is unavailable. Retry after a stable release is published.'
IFS=$'\t' read -r version name size source_hash source_url node_version node_name node_hash node_url < "$stage/manifest.tsv" || fail 'Invalid download manifest.'
semver='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
[[ "$version" =~ $semver && "$node_version" =~ $semver && "${node_version%%.*}" -ge 24 ]] || fail 'Invalid release/runtime version.'
[[ "$source_hash" =~ ^[a-f0-9]{64}$ && "$node_hash" =~ ^[a-f0-9]{64}$ && "$size" =~ ^[1-9][0-9]{0,8}$ ]] || fail 'Invalid integrity metadata.'
[[ "$name" == "SIAAS-Personal-$version-source.zip" && "$source_url" == "https://github.com/siaas-software/siaas-personal/releases/download/v$version/$name" ]] || fail 'Untrusted application download URL.'
[[ "$node_name" == "node-v$node_version-$platform-$arch.tar.gz" && "$node_url" == "https://nodejs.org/dist/v$node_version/$node_name" ]] || fail 'Untrusted runtime download URL.'
printf 'Downloading and verifying application source and Node.js %s…\n' "$node_version"
get "$source_url" "$stage/source.zip" || fail 'Application download failed. Check the network and retry.'
[[ "$(hash "$stage/source.zip")" == "$source_hash" && "$(wc -c < "$stage/source.zip" | tr -d ' ')" == "$size" ]] || fail 'Application archive integrity verification failed.'
get "$node_url" "$stage/node.tar.gz" || fail 'Runtime download failed.'
get "https://nodejs.org/dist/v$node_version/SHASUMS256.txt" "$stage/checksums" || fail 'Official runtime checksums are unavailable.'
official_hash="$(awk -v name="$node_name" '$2 == name { print $1 }' "$stage/checksums")"
[[ "$official_hash" == "$node_hash" && "$(hash "$stage/node.tar.gz")" == "$node_hash" ]] || fail 'Runtime integrity verification failed.'
tar --no-same-owner -xzf "$stage/node.tar.gz" -C "$stage"
extracted="$stage/${node_name%.tar.gz}"
[[ "$(env -u NODE_OPTIONS -u NODE_PATH "$extracted/bin/node" --version)" == "v$node_version" ]] || fail 'The runtime is incompatible with this computer.'
runtime="$install_root/runtimes/node-v$node_version-$platform-$arch"
mkdir -p "$install_root/runtimes"
if [[ -e "$runtime" ]]; then
 [[ -f "$runtime/bin/node" && "$(hash "$runtime/bin/node")" == "$(hash "$extracted/bin/node")" ]] || fail "Close SIAAS Personal, rename the damaged runtime at $runtime, and rerun the installer. Your data is preserved."
else mv "$extracted" "$runtime"; fi
node="$runtime/bin/node"
unzip -q "$stage/source.zip" -d "$stage/source"
export SIAAS_INSTALL_DIR="$install_root"
env -u NODE_OPTIONS -u NODE_PATH "$node" --input-type=module - "$stage" "$runtime" "$version" "$platform" "$arch" "$name" "$size" "$source_hash" "$source_url" "$node_version" "$node_name" "$node_hash" "$node_url" <<'JS'
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const [stage,folder,version,platform,arch,name,size,sha256,downloadUrl,nv,nn,nh,nu]=process.argv.slice(2);
const node=join(folder,'bin/node'),npm=join(folder,'lib/node_modules/npm/bin/npm-cli.js');
writeFileSync(join(folder,'runtime.json'),JSON.stringify({folder,node,npm,version:nv,binarySha256:createHash('sha256').update(readFileSync(node)).digest('hex')}));
writeFileSync(join(stage,'manifest.json'),JSON.stringify({schemaVersion:1,version,platform,arch,name,size:Number(size),sha256,downloadUrl,runtime:{version:nv,name:nn,sha256:nh,url:nu}}));
JS
env -u NODE_OPTIONS -u NODE_PATH "$node" "$stage/source/scripts/source-manager.mjs" install --prepared "$stage" --manifest "$stage/manifest.json"

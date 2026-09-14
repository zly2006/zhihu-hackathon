#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/deploy-off.sh [options]

Build the current checkout on `off`, deploy it as a Docker container, add an
FRP TCP proxy, and verify the app through the public FRP port.

Options:
  --host-port PORT       off host port (default: 15181)
  --remote-port PORT     FRP public port (default: 25182)
  --proxy-name NAME      FRP proxy name (default: zhihu-hackathon)
  --public-url URL       optional HTTPS/HTTP URL to verify after FRP check
  --public-domain HOST   HTTPS domain to route to this release (default: restart-life.ai2.fintechedu.cn)
  --runtime-env FILE     remote runtime env file (default: /home/dom/services/zhihu-hackathon/runtime.env)
  --help                 show this help

The remote runtime env file must already exist and contain the server-side
variables from `.env.example`; its contents are never copied to the repository
or printed by this script.
EOF
}

host_port=15181
remote_port=25182
proxy_name=zhihu-hackathon
public_url="${PUBLIC_URL:-}"
public_domain="${PUBLIC_DOMAIN:-restart-life.ai2.fintechedu.cn}"
remote_env_file="${REMOTE_ENV_FILE:-/home/dom/services/zhihu-hackathon/runtime.env}"
frp_public_host="${FRP_PUBLIC_HOST:-39.96.44.20}"
expected_marker="${EXPECTED_MARKER:-假如我们的人生}"
remote_root="/home/dom/services/zhihu-hackathon"
container_name="${CONTAINER_NAME:-zhihu-hackathon}"
image_name="${IMAGE_NAME:-zhihu-hackathon}"

while (($#)); do
  case "$1" in
    --host-port) host_port="${2:?missing value for --host-port}"; shift 2 ;;
    --remote-port) remote_port="${2:?missing value for --remote-port}"; shift 2 ;;
    --proxy-name) proxy_name="${2:?missing value for --proxy-name}"; shift 2 ;;
    --public-url) public_url="${2:?missing value for --public-url}"; shift 2 ;;
    --public-domain) public_domain="${2:?missing value for --public-domain}"; shift 2 ;;
    --runtime-env) remote_env_file="${2:?missing value for --runtime-env}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
done

for command_name in git ssh curl tar; do
  command -v "$command_name" >/dev/null || { echo "missing command: $command_name" >&2; exit 127; }
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
base_commit="$(git rev-parse --short=12 HEAD)"
if git diff --quiet && git diff --cached --quiet; then
  release_id="$base_commit"
else
  release_id="${base_commit}-dirty-$(date +%Y%m%d%H%M%S)"
  echo "[warning] working tree has uncommitted changes; deploying release ${release_id}" >&2
fi
release_dir="${remote_root}/releases/${release_id}"
image_tag="${image_name}:${release_id}"
data_dir="${remote_root}-data"

echo "[preflight] ssh off"
ssh -o BatchMode=yes off "set -e; id; hostname; sudo -n true; test -r ~/frp/frpc.toml; sudo -n systemctl status frpc.service --no-pager -n 5 >/dev/null; grep -q '^serverAddr = \"${frp_public_host}\"' ~/frp/frpc.toml; grep -q '^serverPort = 6999' ~/frp/frpc.toml"

echo "[preflight] ports"
existing_container_id="$(ssh off "sudo docker ps -aq -f name='^${container_name}$'")"
existing_proxy_block="$(ssh off "grep -A5 -B2 -F 'name = \"${proxy_name}\"' ~/frp/frpc.toml || true")"
if [[ -n "$existing_container_id" ]]; then
  existing_mapping="$(ssh off "sudo docker port '${container_name}' 3000/tcp 2>/dev/null || true")"
  if [[ -n "$existing_mapping" && "$existing_mapping" != *":${host_port}"* ]]; then
    echo "existing container ${container_name} is mapped to an unexpected host port: ${existing_mapping}" >&2
    exit 3
  fi
fi
if [[ -n "$existing_proxy_block" ]]; then
  if [[ "$existing_proxy_block" != *"localPort = ${host_port}"* || "$existing_proxy_block" != *"remotePort = ${remote_port}"* ]]; then
    echo "existing FRP proxy ${proxy_name} has unexpected ports" >&2
    printf '%s\n' "$existing_proxy_block" >&2
    exit 3
  fi
  echo "reusing existing FRP proxy ${proxy_name}"
else
  /Users/zhaoliyan/.agents/skills/deploy-via-off-frp/scripts/check_ports.sh "$host_port" "$remote_port" / http
fi

echo "[upload] ${release_id}"
ssh off "mkdir -p '${release_dir}' '${remote_root}' '${data_dir}'"
tar -C . \
  --exclude='./.git' \
  --exclude='./node_modules' \
  --exclude='./.next' \
  --exclude='./.data' \
  --exclude='./test-output' \
  --exclude='./.tmp' \
  --exclude='./.env' \
  --exclude='./.env.*' \
  --exclude='./*.tsbuildinfo' \
  --exclude='./.DS_Store' \
  -czf - . | ssh off "tar -xzf - -C '${release_dir}'"

echo "[preflight] runtime env"
ssh off "test -s '${remote_env_file}' && test \"\$(stat -c '%a' '${remote_env_file}' 2>/dev/null || stat -f '%Lp' '${remote_env_file}')\" = 600" \
  || { echo "remote runtime env is missing or not mode 600: ${remote_env_file}" >&2; exit 2; }

echo "[build] ${image_tag}"
ssh off "cd '${release_dir}' && sudo env DOCKER_BUILDKIT=0 HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= \\
  docker build --pull=false --network host -t '${image_tag}' ."

echo "[seed] author corpora"
if [[ -d .data/author-avatars ]]; then
  # 数据卷里的 author-avatars 由容器（root）创建，seed 必须用 sudo 才能写入既有目录。
  tar -C .data -czf - author-avatars | ssh off "sudo mkdir -p '${data_dir}' && sudo tar -xzf - -C '${data_dir}'"
  echo "[seed] uploaded .data/author-avatars to ${data_dir} (merge, runtime caches kept)"
else
  echo "[seed] no local .data/author-avatars; skipping" >&2
fi

echo "[db] migrate"
ssh off "sudo docker run --rm --add-host host.docker.internal:host-gateway --env-file '${remote_env_file}' '${image_tag}' node scripts/db-migrate.mjs"

echo "[run] ${container_name}"
ssh off "sudo docker rm -f '${container_name}' >/dev/null 2>&1 || true; \\
  sudo docker run -d --name '${container_name}' \\
  -p '${host_port}:3000' --add-host host.docker.internal:host-gateway --restart unless-stopped \\
  --env-file '${remote_env_file}' \\
  -v '${data_dir}:/app/.data' \\
  '${image_tag}'"

echo "[verify] off localhost"
local_check="$(ssh off "curl -fsS --max-time 20 -o /tmp/${container_name}.out -w '%{http_code}' http://127.0.0.1:${host_port}/")"
[[ "$local_check" == 200 ]] || { echo "off local check failed: HTTP ${local_check}" >&2; ssh off "sudo docker logs --tail 80 '${container_name}'" >&2 || true; exit 1; }
ssh off "grep -qF '${expected_marker}' /tmp/${container_name}.out" || { echo "off local check did not contain the expected app marker" >&2; exit 1; }

echo "[frp] backup and configure"
if [[ -z "$existing_proxy_block" ]]; then
  ssh off "cp ~/frp/frpc.toml ~/frp/frpc.toml.bak-\$(date +%Y%m%d_%H%M%S); \\
  cat >> ~/frp/frpc.toml <<'EOF'

[[proxies]]
name = \"${proxy_name}\"
type = \"tcp\"
localIP = \"127.0.0.1\"
localPort = ${host_port}
remotePort = ${remote_port}
EOF"
else
  echo "FRP proxy already configured; no duplicate block added"
fi

/Users/zhaoliyan/.agents/skills/deploy-via-off-frp/scripts/restart_frpc_via_off.sh

echo "[verify] public FRP endpoint"
public_check_file="$(mktemp)"
trap 'rm -f "$public_check_file"' EXIT
public_http_code="$(curl -fsS --max-time 30 -o "$public_check_file" -w '%{http_code}' "http://${frp_public_host}:${remote_port}/" || true)"
[[ "$public_http_code" == 200 ]] || {
  echo "public FRP check failed: http://${frp_public_host}:${remote_port}/ -> HTTP ${public_http_code}" >&2
  head -c 400 "$public_check_file" >&2 || true
  echo >&2
  exit 1
}
grep -qF "$expected_marker" "$public_check_file" || { echo "public FRP check did not contain the expected app marker" >&2; exit 1; }
echo "public_http_code=${public_http_code}"

echo "[nginx] route ${public_domain} -> ${remote_port}"
ssh "root@${frp_public_host}" "set -e; config=/etc/nginx/sites-available/${public_domain}.conf; test -f \"\$config\"; cp \"\$config\" \"\$config.bak-\$(date +%Y%m%d_%H%M%S)\"; sed -i -E 's#proxy_pass http://127.0.0.1:[0-9]+;#proxy_pass http://127.0.0.1:${remote_port};#' \"\$config\"; nginx -t; systemctl reload nginx"
domain_check_file="$(mktemp)"
trap 'rm -f "$public_check_file" "$domain_check_file"' EXIT
domain_http_code="$(curl -k -fsS --max-time 30 -o "$domain_check_file" -w '%{http_code}' "https://${public_domain}/" || true)"
[[ "$domain_http_code" == 200 ]] || { echo "public domain check failed: https://${public_domain}/ -> HTTP ${domain_http_code}" >&2; exit 1; }
grep -qF "$expected_marker" "$domain_check_file" || { echo "public domain check did not contain the expected app marker" >&2; exit 1; }
echo "public_domain_http_code=${domain_http_code}"

if [[ -n "$public_url" ]]; then
  echo "[verify] public URL ${public_url}"
  public_url_code="$(curl -fsS --max-time 30 -o "$public_check_file" -w '%{http_code}' "$public_url" || true)"
  [[ "$public_url_code" == 200 ]] || { echo "public URL check failed: HTTP ${public_url_code}" >&2; exit 1; }
  grep -qF "$expected_marker" "$public_check_file" || { echo "public URL check did not contain the expected app marker" >&2; exit 1; }
  echo "public_url_http_code=${public_url_code}"
fi

echo "DEPLOYMENT PASSED release=${release_id} public=http://${frp_public_host}:${remote_port}/"

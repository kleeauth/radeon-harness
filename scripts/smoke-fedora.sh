#!/usr/bin/env bash
# Installs the built .rpm on Fedora, starts the real app under a virtual display with opencode,
# and checks that the window loads and connects. Run inside a fedora container, as root.
set -euo pipefail

rpm_file=$(ls release/*.rpm | grep -vE 'aarch64|arm64' | head -n1)
echo "Installing ${rpm_file}"

dnf install -y "${rpm_file}" xorg-x11-server-Xvfb xorg-x11-xauth nodejs npm curl procps-ng
rpm -qi radeon-harness | head -n 5
command -v radeon-harness

# the app launches opencode itself, so it has to be installed like a user would
npm install -g opencode-ai
opencode --version

# root in a container needs --no-sandbox; a desktop user doesn't
xvfb-run -a radeon-harness --no-sandbox --remote-debugging-port=9222 > app.log 2>&1 &

node scripts/smoke-check.mjs || {
  echo '--- app output'; cat app.log
  echo '--- startup log'; cat "$HOME/.config/Radeon Harness/logs/main.log" 2>/dev/null || echo '(none)'
  exit 1
}

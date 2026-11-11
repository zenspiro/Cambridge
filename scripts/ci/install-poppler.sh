#!/usr/bin/env bash
# Poppler (pdftotext, pdftocairo) for CI and the brain workflow. On 11 Nov 2026 GitHub's runners could not resolve
# Ubuntu's own mirrors for hours, and every browser test run failed before a test ran. So: Ubuntu's mirrors briefly,
# then other Ubuntu mirrors, each with short timeouts. Exits non-zero only when none of them answered.
set -u
command -v pdftocairo >/dev/null && exit 0
# An apt-get left behind by an earlier step that was cut short holds the lock (it did on 11 Nov 2026): stop it first.
sudo pkill -x apt-get 2>/dev/null && sleep 2
apt_try() { timeout 90 sudo apt-get -o DPkg::Lock::Timeout=30 -o Acquire::Retries=0 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 "$@"; }
if apt_try update -qq && apt_try install -y -qq --no-install-recommends poppler-utils; then exit 0; fi
. /etc/os-release
for mirror in https://mirrors.edge.kernel.org/ubuntu https://mirror.math.princeton.edu/pub/ubuntu; do
  echo "::warning::Ubuntu's mirrors did not answer; trying ${mirror} for Poppler"
  list=$(mktemp)
  printf 'deb %s %s main universe\ndeb %s %s-updates main universe\n' "$mirror" "$VERSION_CODENAME" "$mirror" "$VERSION_CODENAME" > "$list"
  opts=(-o "Dir::Etc::sourcelist=$list" -o "Dir::Etc::sourceparts=-")
  if apt_try "${opts[@]}" update -qq && apt_try "${opts[@]}" install -y -qq --no-install-recommends poppler-utils; then exit 0; fi
done
echo "::error::Poppler could not be installed: no Ubuntu mirror answered"
exit 1

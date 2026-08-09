#!/usr/bin/env bash
# READ-ONLY live smoke checks — does not mutate auth, DB, or KB.
set -euo pipefail

CK=/tmp/wf-live.ck
rm -f "$CK"
echo "== local anonymous portfolio"
curl -sS -o /dev/null -w "portfolio_anon=%{http_code} redirect=%{redirect_url}\n" http://127.0.0.1:18092/portfolio
echo "== local login (uses existing credentials on server)"
curl -sS -c "$CK" -b "$CK" -X POST \
  -d 'username=admin&password=admin&next=/portfolio' \
  -o /dev/null -w "login_post=%{http_code} redirect=%{redirect_url}\n" \
  http://127.0.0.1:18092/login || true
echo "== local portfolio authed"
curl -sS -b "$CK" -o /tmp/wf-port.html -w "portfolio_auth=%{http_code}\n" http://127.0.0.1:18092/portfolio || true
grep -o 'Michele[^<]*' /tmp/wf-port.html 2>/dev/null | head -3 || true
grep -o 'Action Center\|Da revisionare\|Portfolio' /tmp/wf-port.html 2>/dev/null | head -5 || true
echo "== local new routes"
for p in /clients /frameworks /mappings /audit /settings /checklist /gaps /evidence /report /profile; do
  code=$(curl -sS -b "$CK" -o /dev/null -w "%{http_code}" "http://127.0.0.1:18092${p}" 2>/dev/null || echo "000")
  echo "$p $code"
done
echo "== evidence download"
EV=$(curl -sS -b "$CK" "http://127.0.0.1:18092/api/evidence?program_id=program-michele-cyber-2026" 2>/dev/null | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d[0].get("evidence_id") if isinstance(d,list) and d else d.get("evidence",[{}])[0].get("evidence_id","")) if d else "")' 2>/dev/null || true)
if [[ -n "${EV}" ]]; then
  curl -sS -b "$CK" -o /dev/null -w "evidence_dl=%{http_code}\n" "http://127.0.0.1:18092/api/evidence/${EV}/download"
else
  curl -sS -b "$CK" -o /tmp/ev.bin -w "evidence_dl=%{http_code} bytes=%{size_download}\n" "http://127.0.0.1:18092/api/evidence/EV-001/download?program_id=program-michele-cyber-2026" || true
fi
echo "== live HTTPS headers"
curl -sS -D - -o /dev/null https://compliance.wayfold.xyz/login | tr -d '\r' | grep -iE 'HTTP/|strict-transport|content-security|x-content-type|referrer-policy|permissions-policy|x-frame|content-type' || true
echo "== live anonymous"
curl -sS -o /dev/null -w "live_portfolio=%{http_code} redirect=%{redirect_url}\n" https://compliance.wayfold.xyz/portfolio
echo "== live login+portfolio"
rm -f /tmp/wf-live2.ck
curl -sS -c /tmp/wf-live2.ck -b /tmp/wf-live2.ck -X POST \
  -d 'username=admin&password=admin&next=/portfolio' \
  -o /dev/null -w "live_login=%{http_code} redirect=%{redirect_url}\n" \
  https://compliance.wayfold.xyz/login || true
curl -sS -b /tmp/wf-live2.ck -o /tmp/live-port.html -w "live_portfolio_auth=%{http_code}\n" https://compliance.wayfold.xyz/portfolio || true
grep -c 'Michele' /tmp/live-port.html 2>/dev/null || true
echo "== build-info"
curl -sS -b "$CK" https://compliance.wayfold.xyz/api/build-info 2>/dev/null | head -c 400 || true
echo

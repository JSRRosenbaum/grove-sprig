#!/bin/sh
# Authenticode-sign a Windows PE with the local Herdr code-signing chain.
# Usage: sign-windows.sh <in.exe> <out.exe>
# Chain: $HOME/Projects/tools/herdr-codesign (ca.crt + leaf.p12, pass "herdr").
# Trust: import ca.crt into each target machine LocalMachine Root + TrustedPublisher:
#   certutil -addstore -f Root ca.crt && certutil -addstore -f TrustedPublisher ca.crt
set -e
D="$HOME/Projects/tools/herdr-codesign"
[ $# -eq 2 ] || { echo "usage: $0 <in.exe> <out.exe>" >&2; exit 2; }
osslsigncode sign -pkcs12 "$D/leaf.p12" -pass herdr \
  -n "Herdr" -i "https://herdr.jezzick.net" \
  -ts http://timestamp.sectigo.com \
  -in "$1" -out "$2"
osslsigncode verify -CAfile "$D/ca.crt" "$2"

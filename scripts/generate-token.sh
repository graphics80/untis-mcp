#!/usr/bin/env bash
# Usage: ./scripts/generate-token.sh <label>
# Example: ./scripts/generate-token.sh alice
# Output: alice:Xj7kP2...  (ready to paste into MCP_TOKENS)

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <label>" >&2
  exit 1
fi

TOKEN=$(openssl rand -base64 48 | tr -d '=/+' | head -c 48)
echo "${1}:${TOKEN}"

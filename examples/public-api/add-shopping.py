"""Python 3: add a purchase using only the standard library."""

import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request
import uuid


def uuid_v7():
    raw = bytearray(secrets.token_bytes(16))
    raw[:6] = int(time.time() * 1000).to_bytes(6, "big")
    raw[6] = (raw[6] & 15) | 112
    raw[8] = (raw[8] & 63) | 128
    return str(uuid.UUID(bytes=bytes(raw)))


secret = os.environ.get("HAOTIKA_API_KEY")
if not secret:
    raise SystemExit("Set HAOTIKA_API_KEY in your environment.")
base = os.environ.get("HAOTIKA_API_BASE_URL", "https://chaotika.ru/api/public/v1").rstrip("/")
operation_id = os.environ.get("HAOTIKA_OPERATION_ID") or uuid_v7()
print("Operation ID (save and reuse for retries):", operation_id, flush=True)
payload = {"id": operation_id, "text": sys.argv[1] if len(sys.argv) > 1 else "Молоко", "shoppingCategory": "groceries"}
request = urllib.request.Request(
    base + "/shopping",
    data=json.dumps(payload).encode("utf-8"),
    headers={"Authorization": "Bearer " + secret, "Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(request, timeout=20) as response:
        print(json.dumps(json.load(response), ensure_ascii=False, indent=2))
except urllib.error.HTTPError as error:
    raise SystemExit(f"HTTP {error.code}: {error.read().decode('utf-8')}") from error

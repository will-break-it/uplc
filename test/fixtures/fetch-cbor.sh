#!/bin/bash
# Fetch CBOR for all popular contracts from Blockfrost
# Usage: BLOCKFROST_PROJECT_ID=xxx ./fetch-cbor.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CBOR_DIR="$SCRIPT_DIR/cbor"
mkdir -p "$CBOR_DIR"

if [ -z "${BLOCKFROST_PROJECT_ID:-}" ]; then
  if [ -f "$SCRIPT_DIR/../../.env" ]; then
    export $(grep BLOCKFROST_PROJECT_ID "$SCRIPT_DIR/../../.env" | xargs)
  fi
fi

if [ -z "${BLOCKFROST_PROJECT_ID:-}" ]; then
  echo "Error: BLOCKFROST_PROJECT_ID not set"
  exit 1
fi

HASHES=(
  e1317b152faac13426e6a83e06ff88a4d62cce3c1634ab0a5ec13309
  a65ca58a4e9c755fa830173d2a5caed458ac0c73f97db7faae2e7e3b
  ba158766c1bae60e2117ee8987621441fac66a5e0fb9c7aca58cf20a
  e0302560ced2fdcbfcb2602697df970cd0d6a38f94b32703f51c312b
  fa6a58bbe2d0ff05534431c8e2f0ef2cbdc1602a8456e4b13c8f3077
  6b9c456aa650cb808a9ab54326e039d5235ed69f069c9664a8fe5b69
  e9823c2d96ffc29ba6dd695fd85f784aa081bdcc01f92bb43242e752
  464eeee89f05aff787d40045af2a40a83fd96c513197d32fbc54ff02
  ea184d0a7e640c4b5daa3f2cef851e75477729c2fd89f6ffbed7874c
  e628bfd68c07a7a38fcd7d8df650812a9dfdbee54b1ed4c25c87ffbf
  2618e94cdb06792f05ae9b1ec78b0231f4b7f4215b1b4cf52e6342de
  ed97e0a1394724bb7cb94f20acf627abc253694c92b88bf8fb4b7f6f
  1af84a9e697e1e7b042a0a06f061e88182feb9e9ada950b36a916bd5
  6ec4acc3fbbd570ada625f24902777cec5d7a349fa0f3c7ba87b0cff
  4a59ebd93ea53d1bbf7f82232c7b012700a0cf4bb78d879dabb1a20a
  9068a7a3f008803edac87af1619860f2cdcde40c26987325ace138ad
  c727443d77df6cff95dca383994f4c3024d03ff56b02ecc22b0f3f65
  f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c
  fc7fa1cfd7b5b4db904bd2ab95df8ba8050b8fb7c7fc776cd214ec8f
  e8191d57b95140cbdbf06ff9035b22551c1fa7374908aa4b5ed0667e
  61b3802ce748ed1fdaad2d6c744b19f104285f7d318172a5d4f06a4e
  eaeeb6716f41383b1fb53ec0c91d4fbb55aba4f23061b73cdf5d0b62
  1632c998d2e7d662303e9d0f6a090b7bc8a2289e44198a86bdf9098f
  94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469
  1fa8c9199601924c312fb4f206ff632ca575b27f4f97dd02d9a9ae56
  ac35ee89c26b1e582771ed05af54b67fd7717bbaebd7f722fbf430d6
  2ed2631dbb277c84334453c5c437b86325d371f0835a28b910a91a6e
  99b82cb994dc2af44c12cb5daf5ad274211622800467af5bd8c32352
  da5b47aed3955c9132ee087796fa3b58a1ba6173fa31a7bc29e56d4e
)

echo "Fetching ${#HASHES[@]} script CBORs from Blockfrost..."

FAILED=0
SUCCESS=0

for hash in "${HASHES[@]}"; do
  outfile="$CBOR_DIR/$hash.json"
  if [ -f "$outfile" ]; then
    echo "  ✓ $hash (cached)"
    SUCCESS=$((SUCCESS + 1))
    continue
  fi
  
  # Fetch CBOR
  resp=$(curl -sf "https://cardano-mainnet.blockfrost.io/api/v0/scripts/${hash}/cbor" \
    -H "project_id: ${BLOCKFROST_PROJECT_ID}" 2>/dev/null) || {
    echo "  ✗ $hash (fetch failed)"
    FAILED=$((FAILED + 1))
    continue
  }
  
  cbor=$(echo "$resp" | jq -r '.cbor // empty')
  if [ -z "$cbor" ]; then
    echo "  ✗ $hash (no cbor field)"
    FAILED=$((FAILED + 1))
    continue
  fi
  
  echo "$resp" > "$outfile"
  echo "  ✓ $hash"
  SUCCESS=$((SUCCESS + 1))
done

echo ""
echo "Done: $SUCCESS succeeded, $FAILED failed"

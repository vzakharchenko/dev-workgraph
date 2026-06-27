#!/usr/bin/env bash
# Generate PNG diagrams from uml/*.puml (PlantUML) and uml/*.dot (Graphviz)
# into img/ at the repository root.
#
# Requires: plantuml, dot (graphviz)
# Usage: ./scripts/generatePNGFromSchemas.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UML_DIR="$ROOT/uml"
IMG_DIR="$ROOT/img"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "✖ Missing dependency: $1" >&2
    exit 1
  fi
}

require_cmd plantuml
require_cmd dot

mkdir -p "$IMG_DIR"

puml_count=0
dot_count=0

shopt -s nullglob

for puml in "$UML_DIR"/*.puml; do
  echo "→ PlantUML $(basename "$puml")"
  # -o is resolved relative to the source file directory (uml/)
  plantuml -tpng -o ../img "$puml"
  puml_count=$((puml_count + 1))
done

for dot in "$UML_DIR"/*.dot; do
  base="$(basename "$dot" .dot)"
  out="$IMG_DIR/${base}.png"
  echo "→ Graphviz ${base}.dot → img/${base}.png"
  dot -Tpng "$dot" -o "$out"
  dot_count=$((dot_count + 1))
done

png_total="$(find "$IMG_DIR" -maxdepth 1 -name '*.png' | wc -l | tr -d ' ')"

echo ""
echo "✅ Done: ${puml_count} PlantUML file(s), ${dot_count} Graphviz file(s)"
echo "   ${png_total} PNG(s) in ${IMG_DIR}"

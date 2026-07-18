#!/bin/bash
# Download the CES flat files and Census NAICS descriptions needed by the
# pipeline. Usage: ./download.sh <raw_dir>
set -euo pipefail
RAW="${1:?usage: download.sh <raw_dir>}"
mkdir -p "$RAW"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 (contact: leland.mina.shared@gmail.com)"

for f in ce.industry ce.series ce.data.01a.CurrentSeasAE; do
  echo "downloading $f"
  curl -sf -A "$UA" -o "$RAW/$f" "https://download.bls.gov/pub/time.series/ce/$f"
done

echo "downloading 2022 NAICS descriptions"
curl -sf -A "$UA" -o "$RAW/2022_NAICS_Descriptions.xlsx" \
  "https://www.census.gov/naics/2022NAICS/2022_NAICS_Descriptions.xlsx"
echo "done"

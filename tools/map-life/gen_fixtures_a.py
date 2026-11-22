#!/usr/bin/env python3
"""Generate decoded grayscale mask fixtures (.gray.gz + .json sha256) for group A wind islands.

Matches the exact fixture format used by tests/render/mapLifeLayer.test.ts:
  - tests/fixtures/<id>-sway-mask.gray.gz: gzipped "W H\n" + raw 8-bit grayscale bytes
  - tests/fixtures/<id>-sway-mask.json:    {"source": "public/art2d/life/<id>-sway.webp", "sha256": "..."}

Usage:
    python3 tools/map-life/gen_fixtures_a.py [i01 i02 ...]
"""
from __future__ import annotations

import gzip
import hashlib
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ISLANDS = ('i01', 'i02', 'i04', 'i05', 'i07', 'i08')


def main() -> None:
    islands = sys.argv[1:] if len(sys.argv) > 1 else list(DEFAULT_ISLANDS)
    fixtures_dir = ROOT / 'tests/fixtures'
    fixtures_dir.mkdir(parents=True, exist_ok=True)

    summary = []
    for island in islands:
        webp_path = ROOT / f'public/art2d/life/{island}-sway.webp'
        if not webp_path.exists():
            raise FileNotFoundError(f'Missing sway mask: {webp_path}')

        raw_webp = webp_path.read_bytes()
        sha = hashlib.sha256(raw_webp).hexdigest()

        im = Image.open(webp_path).convert('L')
        w, h = im.size
        payload = f'{w} {h}\n'.encode('ascii') + im.tobytes()

        gz_path = fixtures_dir / f'{island}-sway-mask.gray.gz'
        gz_path.write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))

        meta_path = fixtures_dir / f'{island}-sway-mask.json'
        meta = {
            'source': f'public/art2d/life/{island}-sway.webp',
            'sha256': sha,
        }
        meta_path.write_text(json.dumps(meta, indent=2) + '\n')
        summary.append({
            'island': island,
            'size': [w, h],
            'sha256': sha[:16] + '...',
            'gz_bytes': gz_path.stat().st_size,
        })

    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()

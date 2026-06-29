#!/usr/bin/env python3
"""
Download product images from Google Drive, convert to WebP, upload to Hostinger FTP.
"""
import json
import os
import subprocess
import sys
import time
from ftplib import FTP
from pathlib import Path

BASE_DIR = Path("/home/jasme/Building-Innovation-AI-main-updated")
SKU_MAP_FILE = BASE_DIR / "sku_image_map.json"
IMAGES_DIR = BASE_DIR / "product-images"
WEBP_DIR = BASE_DIR / "product-webp"

FTP_HOST = "157.173.208.16"
FTP_USER = "u496083892.buildingapp.us"
FTP_PASS = "5>PmwM/2k;l|XMeW"
FTP_PORT = 21

SKIP_DOWNLOAD = False  # set True to re-run just convert+upload
SKIP_UPLOAD = False    # set True to skip upload

IMAGES_DIR.mkdir(exist_ok=True)
WEBP_DIR.mkdir(exist_ok=True)

with open(SKU_MAP_FILE) as f:
    sku_map = json.load(f)

print(f"Total products with images: {len(sku_map)}")

# ── STEP 1: Download ────────────────────────────────────────────
if not SKIP_DOWNLOAD:
    downloaded = 0
    failed = []
    already = list(IMAGES_DIR.glob("*"))
    already_skus = {p.stem.split("_")[0] for p in already}
    print(f"Already downloaded: {len(already)} files")

    for i, (sku, url) in enumerate(sku_map.items()):
        if sku in already_skus:
            continue

        out_file = IMAGES_DIR / f"{sku}.png"  # Google Drive gives raw images
        print(f"[{i+1}/{len(sku_map)}] Downloading {sku}...", end=" ", flush=True)

        try:
            result = subprocess.run(
                ["curl", "-sS", "-L", "--max-time", "60",
                 "-o", str(out_file), url],
                capture_output=True, text=True, timeout=70
            )
            if result.returncode == 0 and out_file.stat().st_size > 1000:
                print(f"OK ({out_file.stat().st_size} bytes)")
                downloaded += 1
            else:
                print(f"FAIL (size={out_file.stat().st_size if out_file.exists() else 0})")
                failed.append(sku)
                if out_file.exists():
                    out_file.unlink()
        except Exception as e:
            print(f"ERROR: {e}")
            failed.append(sku)

        # polite delay
        if i % 3 == 0:
            time.sleep(0.5)

    print(f"\nDownload complete: {downloaded} new, {len(failed)} failed")
    if failed:
        print(f"Failed SKUs: {failed}")

# ── STEP 2: Convert to WebP ─────────────────────────────────────
converted = 0
conv_failed = []
already_webp = list(WEBP_DIR.glob("*.webp"))
already_webp_skus = {p.stem for p in already_webp}
print(f"\nAlready converted to WebP: {len(already_webp)} files")

for img_file in sorted(IMAGES_DIR.glob("*")):
    sku = img_file.stem.split("_")[0]  # handles test files
    webp_file = WEBP_DIR / f"{sku}.webp"

    if sku in already_webp_skus:
        continue

    print(f"Converting {sku}...", end=" ", flush=True)
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error",
             "-i", str(img_file),
             "-quality", "85",
             "-compression_level", "6",
             str(webp_file)],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0 and webp_file.stat().st_size > 100:
            print(f"OK ({webp_file.stat().st_size} bytes)")
            converted += 1
        else:
            print(f"FAIL: {result.stderr.strip()[:200]}")
            conv_failed.append(sku)
    except Exception as e:
        print(f"ERROR: {e}")
        conv_failed.append(sku)

print(f"\nConversion complete: {converted} new, {len(conv_failed)} failed")

# ── STEP 3: Upload to FTP ───────────────────────────────────────
if not SKIP_UPLOAD:
    print("\nConnecting to FTP...")
    ftp = FTP(FTP_HOST)
    ftp.login(FTP_USER, FTP_PASS)
    ftp.cwd("products")

    # list existing files on server
    existing = set()
    ftp.retrlines("NLST", existing.add)
    print(f"Server already has {len(existing)} files in products/")

    uploaded = 0
    upload_failed = []

    for webp_file in sorted(WEBP_DIR.glob("*.webp")):
        filename = webp_file.name
        if filename in existing:
            continue  # skip if already there

        print(f"Uploading {filename}...", end=" ", flush=True)
        try:
            with open(webp_file, "rb") as fh:
                ftp.storbinary(f"STOR {filename}", fh)
            print(f"OK")
            uploaded += 1
        except Exception as e:
            print(f"FAIL: {e}")
            upload_failed.append(filename)
            # reconnect on failure
            try:
                ftp.quit()
            except:
                pass
            time.sleep(2)
            ftp = FTP(FTP_HOST)
            ftp.login(FTP_USER, FTP_PASS)
            ftp.cwd("products")

    ftp.quit()
    print(f"\nUpload complete: {uploaded} new, {len(upload_failed)} failed")

# ── Summary ─────────────────────────────────────────────────────
print("\n" + "=" * 60)
print(f"TOTAL IMAGES: {len(sku_map)}")
print(f"Downloaded: {len(list(IMAGES_DIR.glob('*')))} files")
print(f"Converted (WebP): {len(list(WEBP_DIR.glob('*.webp')))} files")

# Verify a few
print("\nVerification samples:")
for webp_file in sorted(WEBP_DIR.glob("*.webp"))[:5]:
    print(f"  {webp_file.name}: {webp_file.stat().st_size} bytes")

print("\nDONE. Run 'curl -I https://buildingapp.us/products/{SKU}.webp' to verify serving.")

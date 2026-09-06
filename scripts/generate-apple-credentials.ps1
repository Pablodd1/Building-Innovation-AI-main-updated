<#
.SYNOPSIS
    Zero-Mac Apple Credentials Generator & Encoder for GitHub Actions CI/CD.
.DESCRIPTION
    Generates Certificate Signing Requests (CSR), converts downloaded Apple certificates
    (.cer) to PKCS#12 (.p12), and encodes credentials to Base64 for GitHub Secrets.
#>

param (
    [Parameter(Mandatory = $false)]
    [ValidateSet("GenerateCSR", "ConvertCerToP12", "EncodeProfile", "EncodeP8Key", "AllInOneHelp")]
    [string]$Action = "AllInOneHelp",

    [string]$Email = "comercial.buildinginnovation@gmail.com",
    [string]$Name = "Building Innovation AI",
    [string]$CerFile = "distribution.cer",
    [string]$ProfileFile = "",
    [string]$P8File = "",
    [string]$P12Password = "BuildingInnovation2026!"
)

# Detect OpenSSL
$openssl = "openssl"
if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) {
    $gitOpenSsl = "C:\Program Files\Git\usr\bin\openssl.exe"
    if (Test-Path $gitOpenSsl) {
        $openssl = $gitOpenSsl
    } else {
        Write-Error "OpenSSL not found. Please install Git for Windows or OpenSSL."
        exit 1
    }
}

$outputDir = Join-Path $PSScriptRoot "..\apple-credentials"
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

switch ($Action) {
    "GenerateCSR" {
        $keyPath = Join-Path $outputDir "apple_distribution.key"
        $csrPath = Join-Path $outputDir "apple_distribution.csr"

        Write-Host "`n[1/2] Generating RSA 2048 Private Key: $keyPath" -ForegroundColor Cyan
        & $openssl genrsa -out $keyPath 2048

        Write-Host "`n[2/2] Generating Certificate Signing Request (CSR): $csrPath" -ForegroundColor Cyan
        & $openssl req -new -key $keyPath -out $csrPath -subj "/emailAddress=$Email/CN=$Name/C=US"

        Write-Host "`n=== SUCCESS: CSR GENERATED! ===" -ForegroundColor Green
        Write-Host "File created at: $csrPath" -ForegroundColor Yellow
        Write-Host "`nNEXT STEPS (In your web browser, no Mac required):" -ForegroundColor White
        Write-Host "1. Go to: https://developer.apple.com/account/resources/certificates/add"
        Write-Host "2. Select: 'Apple Distribution' -> Click Continue"
        Write-Host "3. Upload the file: $csrPath"
        Write-Host "4. Download the generated 'distribution.cer' into: $outputDir"
        Write-Host "5. Run: .\scripts\generate-apple-credentials.ps1 -Action ConvertCerToP12"
    }

    "ConvertCerToP12" {
        $keyPath = Join-Path $outputDir "apple_distribution.key"
        $cerPath = if (Test-Path $CerFile) { $CerFile } else { Join-Path $outputDir "distribution.cer" }
        $pemPath = Join-Path $outputDir "distribution.pem"
        $p12Path = Join-Path $outputDir "distribution.p12"
        $base64Txt = Join-Path $outputDir "BUILD_CERTIFICATE_BASE64.txt"

        if (-not (Test-Path $keyPath)) {
            Write-Error "Private key not found at $keyPath. Run with -Action GenerateCSR first."
            exit 1
        }
        if (-not (Test-Path $cerPath)) {
            Write-Error "Certificate not found at $cerPath. Please place your downloaded distribution.cer in $outputDir."
            exit 1
        }

        Write-Host "`nConverting distribution.cer to PEM..." -ForegroundColor Cyan
        & $openssl x509 -in $cerPath -inform DER -out $pemPath -outform PEM

        Write-Host "Creating PKCS#12 bundle (distribution.p12)..." -ForegroundColor Cyan
        & $openssl pkcs12 -export -inkey $keyPath -in $pemPath -out $p12Path -passout "pass:$P12Password"

        Write-Host "Encoding to Base64 for GitHub Secrets..." -ForegroundColor Cyan
        $bytes = [System.IO.File]::ReadAllBytes($p12Path)
        $base64 = [System.Convert]::ToBase64String($bytes)
        $base64 | Out-File -FilePath $base64Txt -Encoding ascii

        Write-Host "`n=== SUCCESS: P12 CERTIFICATE READY! ===" -ForegroundColor Green
        Write-Host "P12 file: $p12Path" -ForegroundColor Yellow
        Write-Host "Password: $P12Password" -ForegroundColor Yellow
        Write-Host "Base64 secret saved to: $base64Txt" -ForegroundColor Yellow
        Write-Host "`nGITHUB SECRETS TO SET:" -ForegroundColor White
        Write-Host "• BUILD_CERTIFICATE_BASE64  -> (Contents of $base64Txt)"
        Write-Host "• P12_PASSWORD              -> $P12Password"
    }

    "EncodeProfile" {
        if (-not (Test-Path $ProfileFile)) {
            Write-Error "Profile file not found at: $ProfileFile"
            exit 1
        }
        $base64Txt = Join-Path $outputDir "BUILD_PROVISION_PROFILE_BASE64.txt"
        $bytes = [System.IO.File]::ReadAllBytes($ProfileFile)
        $base64 = [System.Convert]::ToBase64String($bytes)
        $base64 | Out-File -FilePath $base64Txt -Encoding ascii

        Write-Host "`n=== SUCCESS: PROVISIONING PROFILE ENCODED! ===" -ForegroundColor Green
        Write-Host "Base64 secret saved to: $base64Txt" -ForegroundColor Yellow
        Write-Host "`nGITHUB SECRETS TO SET:" -ForegroundColor White
        Write-Host "• BUILD_PROVISION_PROFILE_BASE64 -> (Contents of $base64Txt)"
    }

    "EncodeP8Key" {
        if (-not (Test-Path $P8File)) {
            Write-Error "P8 file not found at: $P8File"
            exit 1
        }
        $base64Txt = Join-Path $outputDir "APP_STORE_CONNECT_API_KEY_BASE64.txt"
        $bytes = [System.IO.File]::ReadAllBytes($P8File)
        $base64 = [System.Convert]::ToBase64String($bytes)
        $base64 | Out-File -FilePath $base64Txt -Encoding ascii

        Write-Host "`n=== SUCCESS: API KEY ENCODED! ===" -ForegroundColor Green
        Write-Host "Base64 secret saved to: $base64Txt" -ForegroundColor Yellow
        Write-Host "`nGITHUB SECRETS TO SET:" -ForegroundColor White
        Write-Host "• APP_STORE_CONNECT_API_KEY_BASE64 -> (Contents of $base64Txt)"
    }

    "AllInOneHelp" {
        Write-Host "==========================================================" -ForegroundColor Cyan
        Write-Host "   ZERO-MAC APPLE APP STORE DEPLOYMENT TOOLKIT            " -ForegroundColor Cyan
        Write-Host "==========================================================" -ForegroundColor Cyan
        Write-Host "Step 1: Generate CSR on Windows" -ForegroundColor White
        Write-Host "   .\scripts\generate-apple-credentials.ps1 -Action GenerateCSR`n" -ForegroundColor Yellow

        Write-Host "Step 2: Convert downloaded certificate to .p12" -ForegroundColor White
        Write-Host "   .\scripts\generate-apple-credentials.ps1 -Action ConvertCerToP12`n" -ForegroundColor Yellow

        Write-Host "Step 3: Encode downloaded .mobileprovision profile" -ForegroundColor White
        Write-Host "   .\scripts\generate-apple-credentials.ps1 -Action EncodeProfile -ProfileFile path\to\your.mobileprovision`n" -ForegroundColor Yellow

        Write-Host "Step 4: Encode downloaded App Store Connect API Key (.p8)" -ForegroundColor White
        Write-Host "   .\scripts\generate-apple-credentials.ps1 -Action EncodeP8Key -P8File path\to\AuthKey_XXXX.p8`n" -ForegroundColor Yellow
    }
}

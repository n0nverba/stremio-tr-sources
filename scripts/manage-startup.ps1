param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("install", "uninstall", "start", "stop", "status")]
    [string]$Action
)

$rootDir = Split-Path -Parent $PSScriptRoot
$cmdPath = Join-Path $rootDir "Stremio-TR-Baslat.cmd"
$startupPath = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\Startup")
$shortcutFile = Join-Path $startupPath "Stremio-TR-Sources.lnk"

function IsPort7000Running {
    $conn = Get-NetTCPConnection -LocalPort 7000 -ErrorAction SilentlyContinue
    return ($null -ne $conn)
}

function StopServer {
    $conns = Get-NetTCPConnection -LocalPort 7000 -ErrorAction SilentlyContinue
    if ($conns) {
        $pids = $conns | ForEach-Object { $_.OwningProcess } | Select-Object -Unique
        foreach ($procId in $pids) {
            try {
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            } catch {}
        }
        return $true
    }
    return $false
}

function StartServer {
    if (IsPort7000Running) {
        Write-Host " [BILGI] Eklenti zaten calisiyor (Port: 7000)." -ForegroundColor Cyan
        return
    }
    Start-Process -FilePath "$cmdPath" -WorkingDirectory "$rootDir" -WindowStyle Minimized
    for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep -Milliseconds 500
        if (IsPort7000Running) {
            Write-Host " [OK] Eklenti basariyla baslatildi (Port: 7000 - Gorev cubugunda simge durumunda)." -ForegroundColor Green
            return
        }
    }
    Write-Host " [UYARI] Eklenti baslatildi, acilmasi birkac saniye surebilir." -ForegroundColor Yellow
}

switch ($Action) {
    "install" {
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "   Stremio TR Sources - Otomatik Baslatma Kurulumu" -ForegroundColor White
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host ""

        # 1. Build check
        $distJs = Join-Path $rootDir "dist\index.js"
        if (-not (Test-Path $distJs)) {
            Write-Host "[1/3] Ilk derleme yapiliyor..." -ForegroundColor Yellow
            Set-Location $rootDir
            & npm.cmd run build
            if ($LASTEXITCODE -ne 0) {
                Write-Host "[HATA] Derleme basarisiz oldu!" -ForegroundColor Red
                exit 1
            }
        } else {
            Write-Host "[1/3] Derleme hazir (dist/index.js)." -ForegroundColor Green
        }

        # 2. Add to Startup
        Write-Host "[2/3] Windows baslangicina kisayol ekleniyor..." -ForegroundColor Yellow
        try {
            $wsh = New-Object -ComObject WScript.Shell
            $shortcut = $wsh.CreateShortcut($shortcutFile)
            $shortcut.TargetPath = $cmdPath
            $shortcut.WorkingDirectory = "$rootDir"
            $shortcut.WindowStyle = 7 # Minimized
            $shortcut.Description = "Stremio TR Sources Servisi"
            $shortcut.Save()
            Write-Host " [OK] Windows Baslangic klasorune eklendi (Simge durumunda calisir):" -ForegroundColor Green
            Write-Host "      $shortcutFile" -ForegroundColor DarkGray
        } catch {
            Write-Host " [HATA] Kisayol olusturulamadi: $_" -ForegroundColor Red
            exit 1
        }

        # 3. Start server
        Write-Host "[3/3] Eklenti baslatiliyor..." -ForegroundColor Yellow
        StartServer

        # 4. Resolve network IP for universal PC, mobile and TV support
        $instLanIp = Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Ethernet*", "Wi-Fi*" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty IPAddress -First 1
        if (-not $instLanIp) {
            $instLanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like "192.168.*" } | Select-Object -ExpandProperty IPAddress -First 1
        }
        if (-not $instLanIp) {
            $instLanIp = "127.0.0.1"
        }
        $instLanUrl = "http://" + $instLanIp + ":7000/manifest.json"
        $stremioUrl = "stremio://" + $instLanIp + ":7000/manifest.json"

        # 5. Copy universal manifest URL to clipboard and open Stremio
        Set-Clipboard -Value $instLanUrl -ErrorAction SilentlyContinue
        Start-Process $stremioUrl -ErrorAction SilentlyContinue

        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Green
        Write-Host "               KURULUM BASARIYLA TAMAMLANDI!" -ForegroundColor White
        Write-Host "============================================================" -ForegroundColor Green
        Write-Host " * Eklenti artik bilgisayarinizi her actiginizda otomatik baslar." -ForegroundColor White
        Write-Host " * Gorev cubugunda simge durumunda sessizce calisir." -ForegroundColor White
        Write-Host ""
        Write-Host " * DIKKAT: Eklenti adresi panonuza kopyalandi!" -ForegroundColor Yellow
        Write-Host "   Eger Stremio'da yukleme ekrani acilmadiysa:" -ForegroundColor Yellow
        Write-Host "   1. Stremio'da sol menuden Eklentiler (Puzzle simgesi) butonuna basin." -ForegroundColor White
        Write-Host "   2. Ust arama cubuguna Yapistir (Ctrl+V) yapin ve Enter'a basin." -ForegroundColor White
        Write-Host "   3. 'Stremio TR Sources' yanindaki 'Yukle' (Install) butonuna tiklayin." -ForegroundColor White
        Write-Host ""
        Write-Host " * Manifest URL   : $instLanUrl" -ForegroundColor Cyan
        Write-Host " * Yonetim Paneli : http://127.0.0.1:7000/admin/" -ForegroundColor White
        Write-Host " * Telefon / TV   : $instLanUrl" -ForegroundColor Cyan
        Write-Host "============================================================" -ForegroundColor Green
        Write-Host ""
    }

    "uninstall" {
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "   Stremio TR Sources - Otomatik Baslatmayi Kaldir" -ForegroundColor White
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host ""

        if (Test-Path $shortcutFile) {
            Remove-Item $shortcutFile -Force
            Write-Host "[OK] Windows baslangic kisayolu silindi." -ForegroundColor Green
        } else {
            Write-Host "[BILGI] Baslangic klasorunde kisayol bulunamadi." -ForegroundColor Yellow
        }

        $stopped = StopServer
        if ($stopped) {
            Write-Host "[OK] Calisan servis durduruldu." -ForegroundColor Green
        } else {
            Write-Host "[BILGI] Eklenti zaten calismiyordu." -ForegroundColor Yellow
        }

        Write-Host ""
        Write-Host "Otomatik baslatma basariyla kaldirildi." -ForegroundColor Cyan
    }

    "start" {
        StartServer
    }

    "stop" {
        $stopped = StopServer
        if ($stopped) {
            Write-Host "[OK] Stremio TR Sources durduruldu." -ForegroundColor Green
        } else {
            Write-Host "[BILGI] Eklenti zaten calismiyor." -ForegroundColor Yellow
        }
    }

    "status" {
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "          Stremio TR Sources - Durum Kontrolu" -ForegroundColor White
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host ""
        $running = IsPort7000Running
        if ($running) {
            Write-Host "Durum          : CALISIYOR (Port 7000 aktif)" -ForegroundColor Green
            Write-Host "Yonetim Paneli : http://127.0.0.1:7000/admin/" -ForegroundColor White
            Write-Host "Manifest (PC)  : http://127.0.0.1:7000/manifest.json" -ForegroundColor White
            $lanIp = Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Ethernet*", "Wi-Fi*" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty IPAddress -First 1
            if (-not $lanIp) {
                $lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like "192.168.*" } | Select-Object -ExpandProperty IPAddress -First 1
            }
            if ($lanIp) {
                $lanUrl = "http://" + $lanIp + ":7000/manifest.json"
                Write-Host "Manifest (Ag)  : $lanUrl (Mobil / TV)" -ForegroundColor Cyan
            }
            $inStartup = Test-Path $shortcutFile
            if ($inStartup) {
                Write-Host "Otomatik Basla : EVET (Windows acilisinda aktif)" -ForegroundColor Green
            } else {
                Write-Host "Otomatik Basla : HAYIR" -ForegroundColor Yellow
            }
            Start-Process "http://127.0.0.1:7000/admin/"
        } else {
            Write-Host "Durum          : DURDURULDU (Calismiyor)" -ForegroundColor Red
            Write-Host "Baslatmak icin : Stremio-TR-Baslat.cmd veya Kur-Otomatik-Baslat.cmd" -ForegroundColor Yellow
        }
        Write-Host ""
    }
}

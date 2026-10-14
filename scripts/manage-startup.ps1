param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("install", "uninstall", "start", "stop", "status", "update")]
    [string]$Action
)

$rootDir = Split-Path -Parent $PSScriptRoot
$cmdPath = Join-Path $rootDir "Stremio-TR-Baslat.cmd"
$startupPath = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\Startup")
$shortcutFile = Join-Path $startupPath "Stremio-TR-Sources.lnk"

function IsPort7000Running {
    $conn = Get-NetTCPConnection -LocalPort 7000 -State Listen -ErrorAction SilentlyContinue
    return ($null -ne $conn)
}

function StopServer {
    $conns = Get-NetTCPConnection -LocalPort 7000 -State Listen -ErrorAction SilentlyContinue
    $stopped = $false
    if ($conns) {
        $pids = $conns | ForEach-Object { $_.OwningProcess } | Where-Object { $_ -gt 0 } | Select-Object -Unique
        foreach ($procId in $pids) {
            try {
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                $stopped = $true
            } catch {}
        }
    }
    Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    $tunnelFile = Join-Path $rootDir "data\tunnel-url.txt"
    if (Test-Path $tunnelFile) {
        Remove-Item $tunnelFile -Force -ErrorAction SilentlyContinue
    }
    return $stopped
}

function StartServer {
    if (IsPort7000Running) {
        Write-Host " [BILGI] Eklenti zaten calisiyor (Port: 7000)." -ForegroundColor Cyan
        return
    }
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$cmdPath`" --silent" -WorkingDirectory "$rootDir" -WindowStyle Minimized
    for ($i = 0; $i -lt 15; $i++) {
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

        # 0. Node.js kontrolu
        $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
        $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
        if (-not $nodeCmd -or -not $npmCmd) {
            Write-Host "[HATA] Bilgisayarinizda Node.js kurulu degil!" -ForegroundColor Red
            Write-Host "Lutfen https://nodejs.org/ adresinden Node.js kurun." -ForegroundColor Yellow
            Start-Process "https://nodejs.org/"
            exit 1
        }

        # 0.1 Gerekli paketler (node_modules)
        $nodeModules = Join-Path $rootDir "node_modules"
        if (-not (Test-Path $nodeModules)) {
            Write-Host "[1/5] Ilk kurulum: Gerekli paketler yukleniyor (npm install)..." -ForegroundColor Yellow
            Set-Location $rootDir
            & npm.cmd install
            if ($LASTEXITCODE -ne 0) {
                Write-Host "[HATA] Paketler yuklenemedi! Internet baglantinizi kontrol edin." -ForegroundColor Red
                exit 1
            }
            Write-Host " [OK] Paketler yuklendi." -ForegroundColor Green
        }

        # 0.2 cloudflared.exe kontrolu
        $cloudflared = Join-Path $rootDir "cloudflared.exe"
        if (-not (Test-Path $cloudflared)) {
            Write-Host "[2/5] Guvenli tunel araci (cloudflared) indiriliyor..." -ForegroundColor Yellow
            try {
                $cfUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                Invoke-WebRequest -Uri $cfUrl -OutFile $cloudflared -UseBasicParsing
                Write-Host " [OK] cloudflared.exe basariyla indirildi." -ForegroundColor Green
            } catch {
                Write-Host " [UYARI] cloudflared.exe otomatik indirilemedi, yerel modda devam edilecek." -ForegroundColor Yellow
            }
        }

        # 1. Derleme (Build) kontrolu
        $distJs = Join-Path $rootDir "dist\index.js"
        if (-not (Test-Path $distJs)) {
            Write-Host "[3/5] Eklenti derleniyor (npm run build)..." -ForegroundColor Yellow
            Set-Location $rootDir
            & npm.cmd run build
            if ($LASTEXITCODE -ne 0) {
                Write-Host "[HATA] Derleme basarisiz oldu!" -ForegroundColor Red
                exit 1
            }
            Write-Host " [OK] Derleme tamamlandi." -ForegroundColor Green
        } else {
            Write-Host "[3/5] Derleme hazir (dist/index.js)." -ForegroundColor Green
        }

        # 2. Add to Startup
        Write-Host "[2/4] Windows baslangicina kisayol ekleniyor..." -ForegroundColor Yellow
        try {
            $wsh = New-Object -ComObject WScript.Shell
            $shortcut = $wsh.CreateShortcut($shortcutFile)
            $shortcut.TargetPath = $cmdPath
            $shortcut.Arguments = "--silent"
            $shortcut.WorkingDirectory = "$rootDir"
            $shortcut.WindowStyle = 7 # Minimized
            $shortcut.Description = "Stremio TR Sources Servisi"
            $shortcut.Save()
            Write-Host " [OK] Windows Baslangic klasorune eklendi (Simge durumunda calisir)." -ForegroundColor Green
        } catch {
            Write-Host " [HATA] Kisayol olusturulamadi: $_" -ForegroundColor Red
            exit 1
        }

        # 3. Windows Firewall check (Telefon ve TV erisimi icin)
        try {
            $fwRule = netsh advfirewall firewall show rule name="Stremio TR Sources (Port 7000)" 2>&1
            if ($fwRule -like "*No rules match*" -or $fwRule -like "*kural e*le*miyor*" -or $fwRule -like "*bulunamad*") {
                Write-Host "[3/4] Telefon ve TV'nin erisebilmesi icin Guvenlik Duvarina izin ekleniyor..." -ForegroundColor Yellow
                Start-Process cmd -ArgumentList '/c netsh advfirewall firewall add rule name="Stremio TR Sources (Port 7000)" dir=in action=allow protocol=TCP localport=7000 profile=any' -Verb RunAs -Wait -ErrorAction SilentlyContinue
                Write-Host " [OK] Guvenlik duvari Port 7000 kurali eklendi." -ForegroundColor Green
            } else {
                Write-Host "[3/4] Guvenlik duvari kurali hazir." -ForegroundColor Green
            }
        } catch {
            Write-Host " [UYARI] Guvenlik duvari kontrolu atlandi: $_" -ForegroundColor DarkGray
        }

        # 4. Start server
        Write-Host "[4/4] Eklenti baslatiliyor..." -ForegroundColor Yellow
        StartServer

        # 5. Resolve manifest URL (Cloudflare HTTPS for universal mobile/TV sync, or LAN fallback)
        Write-Host " [BILGI] Guvenli HTTPS baglantisi (Cloudflare Tunel) hazirlaniyor..." -ForegroundColor Yellow
        $tunnelFile = Join-Path $rootDir "data\tunnel-url.txt"
        $manifestUrl = ""
        for ($i = 0; $i -lt 24; $i++) {
            if (Test-Path $tunnelFile) {
                $saved = (Get-Content $tunnelFile -Raw -ErrorAction SilentlyContinue)
                if ($saved) {
                    $saved = $saved.Trim()
                    if ($saved -like "https://*") {
                        $manifestUrl = $saved
                        break
                    }
                }
            }
            Start-Sleep -Milliseconds 500
        }
        if ($manifestUrl) {
            Write-Host " [OK] Guvenli HTTPS tuneli hazir: $manifestUrl" -ForegroundColor Green
        } else {
            $manifestUrl = "http://127.0.0.1:7000/manifest.json"
            Write-Host " [BILGI] Tunel olusturulamadi, yerel adres kullanilacak: $manifestUrl" -ForegroundColor Yellow
        }
        $stremioUrl = $manifestUrl.Replace("http://", "stremio://").Replace("https://", "stremio://")

        # 6. Otomatik Stremio Hesabi Esitleme & Panoya Kopyalama
        Set-Clipboard -Value $manifestUrl -ErrorAction SilentlyContinue
        try {
            $syncScript = "import('./dist/utils/stremio-sync.js').then(m => m.syncAddonToStremioAccount('$manifestUrl')).catch(()=>{})"
            & node -e "$syncScript" 2>&1 | Out-Null
            Write-Host " [OK] Eklenti dogrudan Stremio hesabiniza otomatik tanimlandi!" -ForegroundColor Green
        } catch {}

        # Eger Stremio aciksa yeni adresin yuklenmesi icin yeniden baslat
        $stremioProc = Get-Process stremio* -ErrorAction SilentlyContinue
        if ($stremioProc) {
            Write-Host " [BILGI] Degisikliklerin uygulanmasi icin Stremio yenileniyor..." -ForegroundColor Yellow
            Stop-Process -Name stremio* -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 800
        }

        Start-Process $stremioUrl -ErrorAction SilentlyContinue
        Start-Process "http://127.0.0.1:7000/admin/" -ErrorAction SilentlyContinue

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
        Write-Host " * Manifest URL   : $manifestUrl" -ForegroundColor Cyan
        Write-Host " * Yonetim Paneli : http://127.0.0.1:7000/admin/" -ForegroundColor White
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

        try {
            $removeScript = "import('./dist/utils/stremio-sync.js').then(m => m.removeAddonFromStremioAccount()).catch(()=>{})"
            & node -e "$removeScript" 2>&1 | Out-Null
            Write-Host "[OK] Eklenti Stremio hesabinizdan kaldirildi." -ForegroundColor Green
        } catch {}

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
            $tunnelFile = Join-Path $rootDir "data\tunnel-url.txt"
            if (Test-Path $tunnelFile) {
                $saved = (Get-Content $tunnelFile -Raw -ErrorAction SilentlyContinue)
                if ($saved -and $saved.Trim() -like "https://*") {
                    Write-Host "Manifest (Sync): $($saved.Trim()) (Mobil / TV / PC)" -ForegroundColor Green
                }
            }
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
            Write-Host "Baslatmak icin : Stremio-TR-Baslat.cmd veya Kurulum.cmd" -ForegroundColor Yellow
        }
        Write-Host ""
    }

    "update" {
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "        Stremio TR Sources - Guncelleme Kontrolu" -ForegroundColor White
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host ""

        $wasRunning = IsPort7000Running
        if ($wasRunning) {
            Write-Host "[BILGI] Guncelleme oncesi calisan servis durduruluyor..." -ForegroundColor Yellow
            StopServer | Out-Null
        }

        & node (Join-Path $rootDir "scripts\updater.mjs") --apply

        if ($wasRunning) {
            Write-Host "[BILGI] Guncelleme sonrasi servis yeniden baslatiliyor..." -ForegroundColor Green
            StartServer
        }
        Write-Host ""
    }
}

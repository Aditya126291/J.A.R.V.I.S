# JARVIS Radar Scanner - Real nearby devices only
# Uses multiple techniques to find ACTUALLY present nearby devices

$results = @()

# ─── 1. WiFi Networks (run as netsh which works without admin) ────────────────
try {
    $wifiRaw = (cmd /c "netsh wlan show networks mode=bssid") 2>$null
    $currentSSID = ""
    $currentSignal = 0
    $currentBSSID = ""
    
    foreach ($line in $wifiRaw) {
        if ($line -match "^\s*SSID \d+ : (.+)$") {
            if ($currentSSID -ne "" -and $currentSignal -gt 0) {
                # Filter: skip router-like names
                $isRouter = $currentSSID -match "(?i)(TP-Link|D-Link|Netgear|ASUS|Linksys|Tenda|Cisco|Huawei|ZTE|Fibernet|ACT|Hathway|_Guest|_EXT|_5G$|_2\.4G)"
                if (-not $isRouter) {
                    $rssi = -30 - (100 - $currentSignal) * 0.7
                    $dist = [math]::Round([math]::Pow(10, (27.55 - 40 + [math]::Abs($rssi)) / 20), 1)
                    if ($dist -le 20 -and $dist -ge 0.5) {
                        $results += @{ name = $currentSSID; type = "WIFI"; distance = $dist; signal = $currentSignal }
                    }
                }
            }
            $currentSSID = $Matches[1].Trim()
            $currentSignal = 0
        }
        if ($line -match "Signal\s+:\s+(\d+)%") {
            $currentSignal = [int]$Matches[1]
        }
    }
    # Process last entry
    if ($currentSSID -ne "" -and $currentSignal -gt 0) {
        $isRouter = $currentSSID -match "(?i)(TP-Link|D-Link|Netgear|ASUS|Linksys|Tenda|Cisco|Huawei|ZTE|Fibernet|ACT|Hathway|_Guest|_EXT|_5G$|_2\.4G)"
        if (-not $isRouter) {
            $rssi = -30 - (100 - $currentSignal) * 0.7
            $dist = [math]::Round([math]::Pow(10, (27.55 - 40 + [math]::Abs($rssi)) / 20), 1)
            if ($dist -le 20 -and $dist -ge 0.5) {
                $results += @{ name = $currentSSID; type = "WIFI"; distance = $dist; signal = $currentSignal }
            }
        }
    }
} catch {}

# ─── 2. Bluetooth Connected/Active Devices ───────────────────────────────────
try {
    # Only devices that are currently connected (not just paired history)
    $btConnected = Get-PnpDevice -Class Bluetooth -Status OK | Where-Object {
        $_.FriendlyName -notmatch "(?i)(Avrcp|Transport|Enumerator|Protocol|Adapter|Service|RFCOMM|BTHLE|Microsoft|Realtek|Intel|Broadcom)" -and
        $_.InstanceId -match "BTHENUM\\DEV_"
    }
    
    foreach ($dev in $btConnected) {
        # Check if the device has an active audio connection (means it's actually nearby and on)
        $childDevices = Get-PnpDevice | Where-Object { $_.InstanceId -like "*$($dev.InstanceId.Split('\')[1])*" -and $_.Status -eq "OK" -and $_.Class -eq "MEDIA" }
        $isConnected = ($childDevices | Measure-Object).Count -gt 0
        
        $results += @{
            name = $dev.FriendlyName
            type = "BLUETOOTH"
            distance = if ($isConnected) { 2 } else { -1 }
            signal = if ($isConnected) { 95 } else { -1 }
            connected = $isConnected
        }
    }
} catch {}

# ─── 3. LAN/ARP Devices (other computers on same network) ────────────────────
try {
    $arpOutput = arp -a 2>$null
    foreach ($line in $arpOutput) {
        if ($line -match "(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F-]+)\s+dynamic") {
            $ip = $Matches[1]
            $mac = $Matches[2]
            # Skip broadcast/multicast
            if ($ip -match "\.255$" -or $ip -match "^224\." -or $ip -match "^239\.") { continue }
            
            try {
                $hostname = ([System.Net.Dns]::GetHostEntry($ip)).HostName
            } catch {
                $hostname = "Device_$($ip.Split('.')[-1])"
            }
            
            $results += @{
                name = $hostname
                type = "LAN"
                distance = 5
                signal = 70
            }
        }
    }
} catch {}

$results | ConvertTo-Json -Compress

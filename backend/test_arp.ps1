$arpOutput = arp -a
$devices = @()

foreach ($line in $arpOutput) {
    if ($line -match '([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)\s+([0-9a-fA-F:-]+)\s+dynamic') {
        $ip = $matches[1]
        $mac = $matches[2]
        $devices += @{ IP = $ip; MAC = $mac }
    }
}

foreach ($dev in $devices) {
    try {
        $hostEntry = [System.Net.Dns]::GetHostEntry($dev.IP)
        $name = $hostEntry.HostName
        Write-Output "Found Network Device: $name ($($dev.IP))"
    } catch {
        Write-Output "Found Unknown Device: $($dev.IP)"
    }
}

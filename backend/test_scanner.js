const { execSync } = require('child_process');

function scanDevices() {
  const devices = [];
  
  // 1. Wi-Fi Scan
  try {
    const wifiOutput = execSync('netsh wlan show networks mode=bssid').toString();
    const networks = wifiOutput.split(/SSID \d+ :/g).slice(1);
    
    networks.forEach(net => {
      const lines = net.split('\n');
      const name = lines[0].trim();
      if (name && name !== '') {
        const signalMatch = net.match(/Signal\s+:\s+(\d+)%/);
        const signal = signalMatch ? parseInt(signalMatch[1]) : 50;
        // Approximation: 100% = 0m, 50% = 10m, 10% = 20m
        const distance = Math.max(1, Math.round(20 - (signal / 100 * 20)));
        
        devices.push({
          name: name,
          type: 'WIFI_NODE',
          distance: distance + 'm'
        });
      }
    });
  } catch (err) {
    console.error('Wifi scan failed');
  }

  // 2. ARP Scan (Local Network)
  try {
    const arpOutput = execSync('arp -a').toString();
    const lines = arpOutput.split('\n');
    lines.forEach(line => {
      const match = line.match(/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)\s+([0-9a-fA-F:-]+)\s+dynamic/);
      if (match) {
        devices.push({
          name: `LAN Device (${match[1]})`,
          type: 'LAN_NODE',
          distance: 'Unknown'
        });
      }
    });
  } catch (err) {
    console.error('ARP scan failed');
  }

  return devices;
}

console.log(JSON.stringify(scanDevices(), null, 2));

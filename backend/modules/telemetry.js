const si = require('systeminformation');

let cachedStats = null;
let cachedAt = 0;
const CACHE_MS = 1500;

async function getSystemStats() {
    if (cachedStats && Date.now() - cachedAt < CACHE_MS) {
        return cachedStats;
    }

    try {
        const [cpu, mem, graphics, temp, network] = await Promise.all([
            si.currentLoad(),
            si.mem(),
            si.graphics(),
            si.cpuTemperature(),
            si.networkStats()
        ]);

        // CPU
        const cpuLoad = cpu.currentLoad ? cpu.currentLoad.toFixed(1) : 0;

        // RAM
        const ramUsed = mem.active ? (mem.active / (1024 ** 3)).toFixed(1) : 0;
        const ramTotal = mem.total ? (mem.total / (1024 ** 3)).toFixed(1) : 0;
        const ramPercent = mem.total ? ((mem.active / mem.total) * 100).toFixed(1) : 0;

        // GPU
        let gpuName = "Unknown GPU";
        let vramUsed = 0;
        let vramTotal = 0;
        let gpuLoad = 0;
        if (graphics.controllers && graphics.controllers.length > 0) {
            const gpu = graphics.controllers[graphics.controllers.length - 1]; // Often the dedicated GPU is last
            gpuName = gpu.model || gpuName;
            vramTotal = gpu.vram || 0; // MB
            vramUsed = gpu.memoryUsed || 0; // MB
            gpuLoad = gpu.utilizationGpu || 0;
        }

        // Temp
        const currentTemp = temp.main || 0;

        // Network (using first active interface usually)
        let netRx = 0;
        let netTx = 0;
        if (network && network.length > 0) {
            netRx = (network[0].rx_sec / 1024).toFixed(1); // KB/s
            netTx = (network[0].tx_sec / 1024).toFixed(1); // KB/s
        }

        cachedStats = {
            cpu: { load: cpuLoad, temp: currentTemp },
            ram: { used: ramUsed, total: ramTotal, percent: ramPercent },
            gpu: { name: gpuName, vramUsed, vramTotal, load: gpuLoad },
            network: { rx: netRx, tx: netTx },
            success: true
        };
        cachedAt = Date.now();
        return cachedStats;
    } catch (e) {
        console.error("[TELEMETRY ERROR]", e);
        return { success: false, error: e.message };
    }
}

module.exports = {
    getSystemStats
};

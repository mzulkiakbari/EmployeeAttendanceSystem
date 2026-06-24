/**
 * Utility to detect if the user is connected to the Office Network.
 * This is used to bypass GPS verification for employees on-site.
 */

// Cache for office configurations to avoid redundant fetches
let cachedOfficeConfigs = null;

/**
 * Fetches office IP configurations from branchWifi.json.
 * @returns {Promise<Array>}
 */
const fetchOfficeConfigs = async () => {
    if (cachedOfficeConfigs) return cachedOfficeConfigs;

    try {
        const response = await fetch('/branchWifi.json');
        if (!response.ok) throw new Error('Failed to load branch WiFi config');
        cachedOfficeConfigs = await response.json();
        console.log('Office configurations loaded dynamically.');
        return cachedOfficeConfigs;
    } catch (err) {
        console.error('Error loading office configs:', err);
        return [];
    }
};

/**
 * Fetches the current public IP of the user using an external service.
 * Includes a fallback mechanism if the primary provider is down.
 * @returns {Promise<string|null>}
 */
export const fetchPublicIP = async () => {
    const providers = [
        { url: 'https://ipv4.seeip.org/jsonip', parser: (data) => data.ip },
        { url: 'https://icanhazip.com', parser: (data) => data.trim() }
    ];

    for (const provider of providers) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
            console.log(`Trying IP provider: ${provider.url}`);
            const response = await fetch(provider.url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`Provider ${provider.url} failed`);

            const rawData = await response.text();
            let data;
            try {
                data = JSON.parse(rawData);
            } catch (e) {
                data = rawData; // Fallback for plain text providers like icanhazip
            }

            const ip = provider.parser(data);
            if (ip) {
                console.log(`Success: IP detected via ${provider.url}`);
                return ip;
            }
        } catch (err) {
            clearTimeout(timeoutId);
            const isTimeout = err.name === 'AbortError';
            console.warn(`Failed to fetch IP from ${provider.url}:`, isTimeout ? 'Timeout (5s)' : err.message);
            continue; // Try next provider
        }
    }

    console.error('All IP providers failed.');
    return null;
};

/**
 * Checks if the user is currently on an authorized office network.
 * @param {string} targetBranch - Optional. If provided, checks specifically for this branch's IP.
 * @returns {Promise<boolean>}
 */
export const isOfficeNetwork = async (targetBranch = null) => {
    const [userIP, configs] = await Promise.all([
        fetchPublicIP(),
        fetchOfficeConfigs()
    ]);

    if (!userIP || configs.length === 0) return false;

    console.log('Detected Public IP:', userIP);

    if (targetBranch) {
        // Find the specific config for the target branch
        const branchConfig = configs.find(c =>
            c.branchName && c.branchName.toLowerCase() === targetBranch.toLowerCase()
        );

        if (branchConfig && branchConfig.ip && branchConfig.ip !== 'random') {
            const isMatch = branchConfig.ip === userIP;
            if (isMatch) {
                console.log(`Office WiFi confirmed specifically for branch: ${targetBranch}`);
            } else {
                console.warn(`IP Mismatch: connected to WiFi with IP ${userIP}, but ${targetBranch} requires ${branchConfig.ip}`);
            }
            return isMatch;
        }
        console.log(`No specific IP config found for branch: ${targetBranch}. Access restricted.`);
        return false;
    }

    // Default legacy behavior: check against all valid IPs if no branch specified
    const allOfficeIPs = configs
        .map(b => b.ip)
        .filter(ip => ip && ip !== 'random');

    const isOffice = allOfficeIPs.includes(userIP);
    if (isOffice) console.log('Office WiFi confirmed via general check.');
    return isOffice;
};

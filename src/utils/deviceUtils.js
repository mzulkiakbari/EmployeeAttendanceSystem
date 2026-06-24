/**
 * Generates a consistent browser fingerprint to identify the device.
 * This is used to lock a user to a specific physical device for attendance.
 */
export const getBrowserFingerprint = () => {
    const {
        userAgent,
        language,
        colorDepth,
        pixelDepth
    } = window.navigator;

    const {
        width,
        height
    } = window.screen;

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Combine multiple signals for a semi-unique string
    const signal = `${userAgent}|${language}|${colorDepth}|${pixelDepth}|${width}x${height}|${timezone}`;

    // Hash the signal to get an 8-character ID
    const hash = hashString(signal).padStart(8, '0');

    // Generate a timestamp string (~8 chars)
    const timestamp = Date.now().toString(36);

    // Generate random characters to fill the remaining length
    let randomPart = '';
    while (randomPart.length < 24) {
        randomPart += Math.random().toString(36).substring(2);
    }

    // Combine and truncate to exactly 32 characters
    return `${hash}${timestamp}${randomPart}`.substring(0, 32);
};

/**
 * Simple hash function for the fingerprint signal
 */
const hashString = (str) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    // Return positive hex string
    return Math.abs(hash).toString(16);
};

/**
 * Helper to get or initialize device ID
 */
export const getDeviceId = () => {
    let deviceId = localStorage.getItem('alkaysan_device_id');
    // Force regeneration if deviceId doesn't exist or isn't exactly 32 characters
    if (!deviceId || deviceId.length !== 32) {
        deviceId = getBrowserFingerprint();
        localStorage.setItem('alkaysan_device_id', deviceId);
    }
    return deviceId;
};

/**
 * Detects the operating system name.
 */
export const getOSName = () => {
    const userAgent = window.navigator.userAgent;
    if (userAgent.indexOf("Win") !== -1) return "Windows";
    if (userAgent.indexOf("Mac") !== -1) return "MacOS";
    if (userAgent.indexOf("Linux") !== -1) return "Linux";
    if (userAgent.indexOf("Android") !== -1) return "Android";
    if (userAgent.indexOf("like Mac") !== -1) return "iOS";
    return "UNKNOWN";
};

/**
 * Returns the abbreviated time zone (e.g., WIB, WITA, WIT) or the standard abbreviation.
 */
export const getAbbrTimeZone = () => {
    try {
        const dateStr = new Date().toLocaleTimeString('en-US', { timeZoneName: 'short' });
        const parts = dateStr.split(' ');
        const abbr = parts[parts.length - 1];

        // Map standard offsets to Indonesian abbreviations if automatic detection fails or returns GMT offsets
        // This is a heuristic and might need adjustment based on specific browser behavior
        if (abbr.includes('GMT') || abbr.includes('UTC')) {
            const offset = -new Date().getTimezoneOffset(); // in minutes
            if (offset === 420) return 'WIB'; // GMT+7
            if (offset === 480) return 'WITA'; // GMT+8
            if (offset === 540) return 'WIT'; // GMT+9
        }

        return abbr;
    } catch (e) {
        return 'UNKNOWN';
    }
};

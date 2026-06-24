/**
 * Menghitung jarak antara dua koordinat menggunakan rumus Haversine.
 * @param {number} lat1 - Latitude titik pertama
 * @param {number} lon1 - Longitude titik pertama
 * @param {number} lat2 - Latitude titik kedua
 * @param {number} lon2 - Longitude titik kedua
 * @returns {number} Jarak dalam meter
 */
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Radius bumi dalam meter
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

// Mapping koordinat cabang (Contoh)
// User dapat menyesuaikan koordinat ini di .env atau langsung di sini
export const BRANCH_LOCATIONS = {
    'Headoffice': { lat: -6.200000, lng: 106.816666 }, // Jakarta (Contoh)
    'Branch_A': { lat: -6.210000, lng: 106.820000 },
    'Branch_B': { lat: -6.220000, lng: 106.830000 },
};

/**
 * Mendapatkan koordinat cabang berdasarkan nama/id.
 * Jika tidak ditemukan, mengembalikan null atau default.
 */
export const getBranchCoordinates = (branchName) => {
    return BRANCH_LOCATIONS[branchName] || BRANCH_LOCATIONS['Headoffice'];
};

/**
 * Menemukan cabang terdekat dari posisi koordinat tertentu.
 * @param {number} lat - Latitude user
 * @param {number} lng - Longitude user
 * @returns {object|null} Cabang terdekat { name, distance, coords }
 */
export const findNearestBranch = (lat, lng) => {
    let nearest = null;
    let minDistance = Infinity;

    for (const [name, coords] of Object.entries(BRANCH_LOCATIONS)) {
        const dist = calculateDistance(lat, lng, coords.lat, coords.lng);
        if (dist < minDistance) {
            minDistance = dist;
            nearest = { name, distance: dist, ...coords };
        }
    }
    return nearest;
};

export const DISTANCE_RADIUS = 50; // Radius utama (meter)
export const DISTANCE_TOLERANCE = 15; // Toleransi radius (meter)
export const MAX_SAFE_DISTANCE = DISTANCE_RADIUS + DISTANCE_TOLERANCE;
export const ACCURACY_THRESHOLD = 50; // Filter akurasi (meter)

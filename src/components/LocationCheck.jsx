import { useState, useEffect, useRef } from 'react';
import { calculateDistance, getBranchCoordinates, findNearestBranch, DISTANCE_RADIUS, MAX_SAFE_DISTANCE, ACCURACY_THRESHOLD, DISTANCE_TOLERANCE } from '../utils/locationUtils';
import { getOrInitSignTime } from '../utils/datetimeUtils';
import { isOfficeNetwork } from '../utils/networkUtils';
import './LocationCheck.css';

const LocationCheck = ({ branchName, onVerified, showNotification, onGoToWifiCheck }) => {
    const [status, setStatus] = useState('searching'); // 'searching', 'outside', 'success', 'error'
    const [distance, setDistance] = useState(null);
    const [accuracy, setAccuracy] = useState(null);
    const [message, setMessage] = useState('Mencari sinyal GPS...');
    const [consecutiveCount, setConsecutiveCount] = useState(0);
    const [permissionError, setPermissionError] = useState(null);
    const [detectedBranch, setDetectedBranch] = useState(null);

    const watchIdRef = useRef(null);
    const statusRef = useRef(status);

    // Keep statusRef in sync with status state for timeout access
    useEffect(() => {
        statusRef.current = status;
    }, [status]);

    // 1-minute GPS timeout logic
    useEffect(() => {
        const timer = setTimeout(() => {
            if (statusRef.current !== 'success') {
                // Determine branch name for the message
                let targetBranchName = branchName || 'Kantor';

                const scannedData = sessionStorage.getItem('scanned_qr_data');
                if (scannedData) {
                    try {
                        const data = JSON.parse(scannedData);
                        if (data.branch) targetBranchName = data.branch;
                    } catch (e) {
                        console.error('Error parsing scan data for hint:', e);
                    }
                }

                showNotification(
                    `Sudah 15 detik mencari GPS. Untuk lebih cepat, silakan hubungkan jaringan anda dengan Wifi ${targetBranchName}`,
                    'info',
                    () => {
                        // Redirect to the live WiFi check page
                        console.log('User closed GPS hint. Redirecting to WiFi Check page.');
                        if (onGoToWifiCheck) onGoToWifiCheck();
                    }
                );
            }
        }, 15000); // 15s

        return () => clearTimeout(timer);
    }, [branchName, showNotification, onGoToWifiCheck]);

    useEffect(() => {
        // Initialize or retrieve existing 6-hour sign-in time cookie
        getOrInitSignTime();

        const startTracking = async () => {
            // New: WiFi Bypass Check
            try {
                // Now branch-aware: only bypass if on the specific WiFi for this branch
                const isOffice = await isOfficeNetwork(branchName);
                if (isOffice) {
                    console.log(`Office WiFi confirmed for ${branchName || 'Office'}.`);
                    setStatus('success');
                    setMessage(`Terhubung ke WiFi ${branchName || 'Kantor'}. Lokasi Terverifikasi!`);
                    setTimeout(() => onVerified(branchName || 'Office'), 800);
                    return;
                }
            } catch (netErr) {
                console.warn('WiFi check skipped due to error:', netErr);
            }

            if (!navigator.geolocation) {
                setPermissionError('Geolokasi tidak didukung oleh browser ini.');
                setStatus('error');
                return;
            }

            setMessage('Mencari sinyal GPS...');

            watchIdRef.current = navigator.geolocation.watchPosition(
                (position) => {
                    const { latitude, longitude, accuracy: currentAccuracy } = position.coords;

                    // Filter: Jika akurasi > 50m, abaikan data koordinat tapi update status visual
                    if (currentAccuracy > ACCURACY_THRESHOLD) {
                        setAccuracy(currentAccuracy);
                        setStatus('searching');
                        setMessage(`Mencari sinyal GPS... (Akurasi: ${currentAccuracy.toFixed(0)}m)`);
                        return;
                    }

                    setAccuracy(currentAccuracy);

                    let targetBranch = null;
                    let currentDistance = null;
                    let targetCoords = null;
                    let targetRadius = DISTANCE_RADIUS;
                    let targetTolerance = DISTANCE_TOLERANCE;

                    // 1. Prioritaskan data dari sessionStorage (Hasil Scan QR)
                    const scannedData = sessionStorage.getItem('scanned_qr_data');
                    if (scannedData) {
                        try {
                            const data = JSON.parse(scannedData);

                            // Support nested coords structure { coords: { lat, lon } } or flat { lat, long/lng }
                            const lat = data.coords ? data.coords.lat : data.lat;
                            const lng = data.coords ? (data.coords.lon || data.coords.lng) : (data.long || data.lng);

                            // Support nested tolerance structure { tolerance: { max } } or flat { tolerance }
                            const maxTolerance = (data.tolerance && typeof data.tolerance === 'object')
                                ? data.tolerance.max
                                : data.tolerance;

                            if (lat && lng) {
                                targetCoords = { lat: parseFloat(lat), lng: parseFloat(lng) };
                                targetRadius = parseFloat(data.radius) || DISTANCE_RADIUS;
                                targetTolerance = parseFloat(maxTolerance) || DISTANCE_TOLERANCE;
                                targetBranch = { name: data.branch || branchName || 'Office', distance: 0 };
                            }
                        } catch (e) {
                            console.error("Error parsing scanned data from session:", e);
                        }
                    }

                    // 2. Fallback ke props/lookup jika tidak ada data dari session
                    if (!targetCoords) {
                        if (branchName) {
                            targetCoords = getBranchCoordinates(branchName);
                            targetBranch = { name: branchName };
                        } else {
                            const nearest = findNearestBranch(latitude, longitude);
                            if (nearest) {
                                targetCoords = { lat: nearest.lat, lng: nearest.lng };
                                targetBranch = nearest;
                            }
                        }
                    }

                    if (!targetCoords) {
                        setStatus('error');
                        setPermissionError('Cabang tidak terdeteksi. Silakan Refresh.');
                        return;
                    }

                    currentDistance = calculateDistance(latitude, longitude, targetCoords.lat, targetCoords.lng);
                    setDistance(currentDistance);
                    setDetectedBranch(targetBranch?.name);

                    // Gunakan radius + toleransi sesuai source data
                    const maxDistance = targetRadius + targetTolerance;

                    if (currentDistance <= maxDistance) {
                        // Instant Success: One accurate point is enough
                        setStatus('success');
                        setMessage('Siap! Anda berada di area kantor.');

                        // Stop tracking immediately
                        if (watchIdRef.current) {
                            navigator.geolocation.clearWatch(watchIdRef.current);
                        }

                        // Faster redirection (500ms instead of 1500ms)
                        setTimeout(() => onVerified(targetBranch?.name), 500);
                    } else if (currentDistance !== null) {
                        // Di luar radius
                        setConsecutiveCount(0);
                        setStatus('outside');
                        setMessage(`Anda berada ${currentDistance.toFixed(0)} meter dari kantor.`);
                    }
                },
                (error) => {
                    console.error('GPS Error:', error);
                    setStatus('error');
                    let msg = 'Gagal mendapatkan lokasi. Pastikan GPS aktif.';
                    if (error.code === error.PERMISSION_DENIED) {
                        msg = 'Izin lokasi ditolak. Harap mengizinkan akses lokasi di pengaturan browser.';
                    }
                    setPermissionError(msg);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                }
            );
        };

        // Meminta izin dan mulai tracking
        startTracking();

        return () => {
            if (watchIdRef.current) {
                navigator.geolocation.clearWatch(watchIdRef.current);
            }
        };
    }, [branchName, onVerified]);

    const getStatusColor = () => {
        if (accuracy > ACCURACY_THRESHOLD) return 'status-red';
        if (status === 'success') return 'status-green';
        if (status === 'outside') return 'status-yellow';
        return 'status-red';
    };

    const getAccuracyLevel = () => {
        if (!accuracy) return { text: '--', color: '#666' };
        if (accuracy <= 15) return { text: 'Bagus', color: '#10b981' };
        if (accuracy <= 30) return { text: 'Cukup', color: '#f59e0b' };
        return { text: 'Buruk', color: '#ef4444' };
    };

    if (permissionError) {
        return (
            <div className="location-check-overlay">
                <div className="location-card error">
                    <span className="material-icons info-icon">location_off</span>
                    <h3>Akses Lokasi Diperlukan</h3>
                    <p>{permissionError}</p>
                    <button className="retry-btn" onClick={() => window.location.reload()}>Coba Lagi</button>
                </div>
            </div>
        );
    }

    return (
        <div className="location-check-overlay">
            <div className={`location-card ${getStatusColor()}`}>
                <div className="radar-container">
                    <div className="radar-pulse"></div>
                    <div className="radar-pulse delay-1"></div>
                    <div className="radar-pulse delay-2"></div>
                    <div className="location-icon-box">
                        <span className="material-icons">
                            {status === 'success' ? 'check_circle' : 'location_on'}
                        </span>
                    </div>
                </div>

                <div className="status-header">
                    <h3>Pencocokan Lokasi</h3>
                    {detectedBranch && <p className="branch-name-tag">{detectedBranch}</p>}
                    <p className="status-message">{message}</p>
                </div>

                {distance !== null && status !== 'success' && (
                    <div className="distance-bar-container">
                        <div
                            className="distance-bar-fill"
                            style={{ width: `${Math.min(100, (DISTANCE_RADIUS / distance) * 100)}%` }}
                        ></div>
                    </div>
                )}

                <div className="accuracy-indicator">
                    <span className="acc-label">Akurasi GPS: {accuracy ? `${accuracy.toFixed(0)}m` : '--'}</span>
                    <span className="acc-tag" style={{ backgroundColor: getAccuracyLevel().color }}>
                        {getAccuracyLevel().text}
                    </span>
                </div>

                {status === 'outside' && (
                    <p className="hint-text">Silakan mendekat ke area kantor untuk mulai absensi.</p>
                )}
            </div>
        </div>
    );
};

export default LocationCheck;

import { useState, useEffect, useRef } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { fetchRegisteredFace as fetchFaceData } from '../utils/apiUtils';
import { compareFaceLandmarks, calculateSimilarity, FACE_ID_THRESHOLD } from '../utils/faceUtils';
import './VerificationPage.css';

// Default office coordinates (4 corners forming a rounded zone)
// Replace these with actual office coordinates
const OFFICE_COORDINATES = [
    { lat: 3.158765, lng: 101.706647 }, // Corner 1
    { lat: 3.157865, lng: 101.707173 }, // Corner 2
    { lat: 3.158159, lng: 101.707712 }, // Corner 3
    { lat: 3.159059, lng: 101.707181 }, // Corner 4
];

const LOCATION_RADIUS_MAX = 30; // Increased from 20 to 30 meters for better stability


const VerificationPage = ({ capturedImage, onVerificationComplete, onRegistrationNeeded, onRetry }) => {
    const [status, setStatus] = useState('face'); // 'face', 'location', 'success', 'failed'
    const [failedAt, setFailedAt] = useState(null); // 'face' or 'location'
    const [faceVerified, setFaceVerified] = useState(false);
    const [locationVerified, setLocationVerified] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [progress, setProgress] = useState(0);
    const [lastScore, setLastScore] = useState(null);
    const [userDistance, setUserDistance] = useState(null);
    const [gpsAccuracy, setGpsAccuracy] = useState(null);
    const watchIdRef = useRef(null);

    // Calculate distance between two coordinates using Haversine formula
    const calculateDistance = (lat1, lon1, lat2, lon2) => {
        const R = 6371e3; // Earth's radius in meters
        const φ1 = (lat1 * Math.PI) / 180;
        const φ2 = (lat2 * Math.PI) / 180;
        const Δφ = ((lat2 - lat1) * Math.PI) / 180;
        const Δλ = ((lon2 - lon1) * Math.PI) / 180;

        const a =
            Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    };

    // Check if user is within office zone and return details
    const getLocationDetails = (userLat, userLng) => {
        let minDistance = Infinity;
        for (const corner of OFFICE_COORDINATES) {
            const distance = calculateDistance(userLat, userLng, corner.lat, corner.lng);
            if (distance < minDistance) {
                minDistance = distance;
            }
        }

        return {
            isWithin: minDistance <= LOCATION_RADIUS_MAX,
            distance: minDistance
        };
    };


    // Advanced FaceID-like Comparison (Translation, Scale, and 3D Rotation Invariant)

    // Face verification using MediaPipe
    const verifyFace = async () => {
        try {
            setProgress(5);

            // Fetch registered face from API
            let registeredFaceData;
            try {
                registeredFaceData = await fetchFaceData();
                setProgress(20);
            } catch (apiError) {
                console.error('VerificationPage: API Error', apiError.message);

                if (apiError.message === 'NOT_REGISTERED') {
                    onRegistrationNeeded(apiError.uniqueId);
                    return false;
                }

                if (apiError.message === 'SESI_BERAKHIR' || apiError.message === 'NOT_LOGGED_IN') {
                    setErrorMessage('Sesi berakhir. Mengalihkan ke halaman login...');
                    setStatus('failed');
                    setTimeout(() => {
                        window.location.reload(); // App.jsx will handle the redirect based on cleared token
                    }, 2000);
                    return false;
                }

                setErrorMessage(apiError.message || 'Terjadi kesalahan saat mengambil data wajah.');
                setFailedAt('face');
                setStatus('failed');
                return false;
            }

            // Initialize MediaPipe Face Landmarker
            const vision = await FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
            );

            setProgress(40);

            const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath:
                        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                    delegate: 'GPU',
                },
                runningMode: 'IMAGE',
                numFaces: 1,
                minFaceDetectionConfidence: 0.5,
                minFacePresenceConfidence: 0.5,
            });

            setProgress(60);

            // Create image element from captured image
            const img = new Image();
            img.src = capturedImage;

            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
            });

            setProgress(75);

            // Detect face in the captured image
            const result = faceLandmarker.detect(img);

            setProgress(85);

            // Check if face was detected
            if (result.faceLandmarks && result.faceLandmarks.length > 0) {
                const capturedLandmarks = result.faceLandmarks[0];

                // Compare with registered face
                const { isMatch, score } = compareFaceLandmarks(capturedLandmarks, registeredFaceData);
                setLastScore(score);

                setProgress(100);

                if (isMatch) {
                    setFaceVerified(true);
                    setFailedAt(null);
                    setStatus('location');
                    return true;
                } else {
                    setErrorMessage('Wajah tidak cocok dengan data terdaftar.');
                    setFailedAt('face');
                    setStatus('failed');
                    return false;
                }
            } else {
                setErrorMessage('Wajah tidak terdeteksi. Silakan coba lagi.');
                setFailedAt('face');
                setStatus('failed');
                return false;
            }
        } catch (error) {
            console.error('Face verification error:', error);
            setErrorMessage('Gagal memverifikasi wajah. Silakan coba lagi.');
            setFailedAt('face');
            setStatus('failed');
            return false;
        }
    };

    // Location verification
    const verifyLocation = () => {
        if (!navigator.geolocation) {
            setErrorMessage('Geolokasi tidak didukung oleh browser Anda.');
            setStatus('failed');
            return;
        }

        // Clear any existing watcher
        if (watchIdRef.current) {
            navigator.geolocation.clearWatch(watchIdRef.current);
        }

        watchIdRef.current = navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude, accuracy } = position.coords;

                // Check if user is within office zone
                const { isWithin, distance } = getLocationDetails(latitude, longitude);
                setUserDistance(distance);
                setGpsAccuracy(accuracy);

                if (isWithin) {
                    setProgress(100);
                    setLocationVerified(true);
                    setFailedAt(null);
                    setStatus('success');
                    setErrorMessage('');

                    // Cleanup watcher on success
                    navigator.geolocation.clearWatch(watchIdRef.current);
                    watchIdRef.current = null;

                    setTimeout(() => {
                        onVerificationComplete({ faceVerified: true, locationVerified: true });
                    }, 1500);
                } else {
                    // Keep status as 'location' to show live tracking
                    setStatus('location');
                    setFailedAt(null);
                    setErrorMessage('');
                    setProgress(75); // Keep progress high but not complete
                }
            },
            (error) => {
                console.error('Geolocation error:', error);
                let message = 'Gagal mendapatkan lokasi. ';
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        message += 'Akses lokasi ditolak.';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        message += 'Informasi lokasi tidak tersedia.';
                        break;
                    case error.TIMEOUT:
                        message += 'Permintaan lokasi timeout.';
                        break;
                    default:
                        message += 'Error tidak diketahui.';
                }
                setErrorMessage(message);
                setFailedAt('location');
                setStatus('failed');
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0,
            }
        );
    };

    const handleRetryAction = () => {
        if (failedAt === 'location') {
            // Only retry location locally
            setStatus('location');
            setErrorMessage('');
            setProgress(0);
            verifyLocation();
        } else {
            // Go back to camera for face failure
            onRetry();
        }
    };

    // Start verification process
    useEffect(() => {
        const startVerification = async () => {
            const faceResult = await verifyFace();
            if (faceResult) {
                // Small delay before location verification for better UX
                setTimeout(() => {
                    verifyLocation();
                }, 500);
            }
        };

        startVerification();

        // Cleanup watcher on unmount
        return () => {
            if (watchIdRef.current) {
                navigator.geolocation.clearWatch(watchIdRef.current);
            }
        };
    }, []);

    const getStatusMessage = () => {
        switch (status) {
            case 'face':
                return 'Memverifikasi wajah...';
            case 'location':
                return 'Memverifikasi lokasi...';
            case 'success':
                return 'Verifikasi berhasil!';
            case 'failed':
                return 'Verifikasi gagal';
            default:
                return 'Memproses...';
        }
    };

    return (
        <div className="verification-page">
            <div className="verification-container">
                {/* Captured image preview */}
                <div className="image-preview">
                    <img src={capturedImage} alt="Captured" />
                    <div className={`image-overlay ${status === 'success' ? 'success' : status === 'failed' ? 'failed' : ''}`}></div>
                </div>

                {/* Verification status */}
                <div className="verification-status">
                    {status !== 'success' && status !== 'failed' && (
                        <div className="loader-container">
                            <div className="loader">
                                <div className="loader-ring"></div>
                                <div className="loader-ring"></div>
                                <div className="loader-ring"></div>
                            </div>
                            <div className="progress-bar">
                                <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                            </div>
                        </div>
                    )}

                    {status === 'success' && (
                        <div className="success-icon">
                            <span className="material-icons">check_circle</span>
                        </div>
                    )}

                    {status === 'failed' && (
                        <div className="error-icon">
                            <span className="material-icons">error</span>
                        </div>
                    )}

                    <h2 className="status-message">{getStatusMessage()}</h2>

                    {errorMessage && <p className="error-message">{errorMessage}</p>}

                    {status === 'failed' && failedAt === 'face' && lastScore && (
                        <div className="debug-score-container">
                            <p className="debug-score">Kemiripan: {calculateSimilarity(lastScore).toFixed(1)}%</p>
                            <p className="score-explanation">(Membutuhkan minimal 80% untuk verifikasi berhasil)</p>
                        </div>
                    )}

                    {(status === 'location' || (status === 'failed' && failedAt === 'location')) && userDistance !== null && (
                        <div className={`distance-info ${userDistance <= LOCATION_RADIUS_MAX ? 'in-range' : 'out-of-range'}`}>
                            <p>Jarak Anda: <strong>{userDistance.toFixed(1)} meter</strong></p>
                            {gpsAccuracy > 50 && (
                                <p className="accuracy-warning">
                                    <span className="material-icons">signal_cellular_alt_1_bar</span>
                                    Sinyal kurang akurat ({gpsAccuracy.toFixed(0)}m). Matikan Wi-Fi atau mendekat ke jendela.
                                </p>
                            )}
                            {userDistance > LOCATION_RADIUS_MAX ? (
                                <p className="distance-hint">Silakan mendekat ke area kantor ({LOCATION_RADIUS_MAX}m)</p>
                            ) : (
                                <p className="distance-hint">Lokasi sudah sesuai!</p>
                            )}
                        </div>
                    )}

                    {/* Verification steps indicator */}
                    <div className="steps-indicator">
                        <div className={`step ${faceVerified ? 'completed' : status === 'face' ? 'active' : ''}`}>
                            <div className="step-icon">
                                <span className="material-icons">face</span>
                            </div>
                            <span>Wajah</span>
                        </div>
                        <div className="step-line"></div>
                        <div className={`step ${locationVerified ? 'completed' : status === 'location' ? 'active' : ''}`}>
                            <div className="step-icon">
                                <span className="material-icons">location_on</span>
                            </div>
                            <span>Lokasi</span>
                        </div>
                    </div>

                    {status === 'failed' && (
                        <button className="retry-btn" onClick={handleRetryAction}>
                            Coba Lagi
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default VerificationPage;

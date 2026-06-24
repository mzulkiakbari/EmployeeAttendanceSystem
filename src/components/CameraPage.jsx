import { useRef, useCallback, useState, useEffect } from 'react';
import Webcam from 'react-webcam';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { updateUserSecurity, saveOfflineAttendance } from '../utils/apiUtils';
import { compareFaceLandmarks, analyzeFaceQuality } from '../utils/faceUtils';
import { getDeviceId } from '../utils/deviceUtils';
import './CameraPage.css';

const CameraPage = ({ onVerificationComplete, onRegistrationNeeded, isVisible, onPinClick, employeeData, isAlreadySigned }) => {
    const webcamRef = useRef(null);
    const [error, setError] = useState(null);
    const [faceLandmarker, setFaceLandmarker] = useState(null);
    const [liveScore, setLiveScore] = useState(null);
    const [isMatching, setIsMatching] = useState(false);
    const [qualityInfo, setQualityInfo] = useState({ status: 'NO_FACE', message: 'Mencari Wajah...' });
    const [boundingBox, setBoundingBox] = useState(null);
    const [isVerifying, setIsVerifying] = useState(false);
    const [statusMessage, setStatusMessage] = useState('Memproses Absensi...');
    const [isUnrecognized, setIsUnrecognized] = useState(false);

    const animationFrameRef = useRef(null);
    const matchStartTime = useRef(null);
    const isVerifyingRef = useRef(false);

    useEffect(() => {
        const init = async () => {
            try {
                const vision = await FilesetResolver.forVisionTasks(
                    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
                );
                const landmarker = await FaceLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                        delegate: 'GPU',
                    },
                    runningMode: 'VIDEO',
                    numFaces: 1,
                    minFaceDetectionConfidence: 0.5,
                });
                setFaceLandmarker(landmarker);
            } catch (err) {
                console.error('Initialization error:', err);
                setError('Gagal menginisialisasi sistem pengenalan wajah. Pastikan kamera diizinkan.');
            }
        };

        const timeout = setTimeout(() => {
            if (isVisible) {
                init();
            }
        }, 100);

        return () => {
            clearTimeout(timeout);
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            if (webcamRef.current && webcamRef.current.stream) {
                webcamRef.current.stream.getTracks().forEach(track => track.stop());
            }
        };
    }, [isVisible]);

    const handleAutoVerify = async (capturedLandmarks) => {
        if (isVerifyingRef.current) return;
        isVerifyingRef.current = true;
        setIsVerifying(true);
        setStatusMessage('Mencari kecocokan wajah...');
        setIsUnrecognized(false);

        try {
            const currentDeviceId = getDeviceId();

            // 1. Verify Face Match with Employee Data
            if (!employeeData || !employeeData.faceId) {
                throw new Error('Data wajah belum terdaftar pada akun ini.');
            }

            let isMatch = false;
            try {
                const regLandmarks = JSON.parse(atob(employeeData.faceId));
                const matchResult = compareFaceLandmarks(capturedLandmarks, regLandmarks);
                isMatch = matchResult.isMatch;
            } catch (e) {
                console.error('Face comparison error:', e);
                throw new Error('Gagal memproses data wajah terdaftar.');
            }

            if (!isMatch) {
                throw new Error('Wajah tidak cocok dengan data pengguna yang login.');
            }

            // 2. Already Signed Check - Removed to allow multiple scans (go_home/overtime)
            if (isAlreadySigned) {
                setStatusMessage(`Halo, ${employeeData.nama_depan_karyawan}!`);
                // allow proceeding
            }

            // 3. Device Check
            const isLegacyDevice = employeeData.device_id && employeeData.device_id.length !== 32;
            if (employeeData.device_id && employeeData.device_id !== currentDeviceId && !isLegacyDevice) {
                saveOfflineAttendance({
                    userId: employeeData.uniqueId,
                    deviceId: currentDeviceId,
                    status: 'PENDING_RESET'
                });
                throw new Error('Anda tidak dapat sign menggunakan device lain. Hubungi Admin.');
            }

            // 5. Update Device ID if missing or migrating from legacy format
            if (!employeeData.device_id || (isLegacyDevice && employeeData.device_id !== currentDeviceId)) {
                await updateUserSecurity(employeeData.uniqueId, {
                    device_id: currentDeviceId
                });
            }

            // Success - WAIT for the parent to finish submission before allowing any state reset
            await onVerificationComplete({
                ...employeeData,
                time: new Date().toLocaleTimeString('id-ID'),
                sign_with: 'face'
            });

            // Note: We don't reset isVerifyingRef here because the page should change to success

        } catch (err) {
            console.error('Attendance error:', err);
            setError(err.message);
            setIsVerifying(false);
            isVerifyingRef.current = false;
        }
    };

    const predict = useCallback(async () => {
        if (!faceLandmarker || !webcamRef.current?.video || isVerifyingRef.current) {
            animationFrameRef.current = requestAnimationFrame(predict);
            return;
        }

        const video = webcamRef.current.video;
        if (video.readyState !== 4) {
            animationFrameRef.current = requestAnimationFrame(predict);
            return;
        }

        const result = faceLandmarker.detectForVideo(video, performance.now());

        if (result.faceLandmarks && result.faceLandmarks.length > 0) {
            const landmarks = result.faceLandmarks[0];
            const quality = analyzeFaceQuality(landmarks);
            setQualityInfo(quality);

            const xs = landmarks.map(p => p.x);
            const ys = landmarks.map(p => p.y);
            const minX = Math.min(...xs), maxX = Math.max(...xs);
            const minY = Math.min(...ys), maxY = Math.max(...ys);

            setBoundingBox({
                left: minX * 100,
                top: minY * 100,
                width: (maxX - minX) * 100,
                height: (maxY - minY) * 100
            });

            if (quality.status === 'OK') {
                if (!matchStartTime.current) {
                    matchStartTime.current = Date.now();
                }

                const elapsed = Date.now() - matchStartTime.current;
                setIsMatching(elapsed > 800);

                if (elapsed > 1500) {
                    handleAutoVerify(landmarks);
                }
                setLiveScore(0);
            } else {
                matchStartTime.current = null;
                setIsMatching(false);
                setLiveScore(null);
            }
        } else {
            setLiveScore(null);
            setIsMatching(false);
            setBoundingBox(null);
            matchStartTime.current = null;
            setQualityInfo({ status: 'NO_FACE', message: 'Mencari Wajah...' });
        }

        animationFrameRef.current = requestAnimationFrame(predict);
    }, [faceLandmarker, handleAutoVerify]);

    useEffect(() => {
        if (faceLandmarker) {
            animationFrameRef.current = requestAnimationFrame(predict);
        }
    }, [faceLandmarker, predict]);

    const videoConstraints = {
        facingMode: 'user',
        width: 640,
        height: 480,
    };

    return (
        <div className="camera-page">
            <Webcam
                audio={false}
                ref={webcamRef}
                screenshotFormat="image/jpeg"
                videoConstraints={videoConstraints}
                className="camera-feed"
                mirrored={true}
                playsInline={true}
                muted={true}
                autoPlay={true}
                onUserMedia={() => {
                    console.log('Camera started');
                    setError(null);
                }}
                onUserMediaError={(err) => {
                    console.error('Webcam error:', err);
                    setError('Kamera tidak dapat diakses. Pastikan aplikasi memiliki izin kamera.');
                }}
            />

            {error && (
                <div className="camera-error-popup">
                    <div className="error-icon">
                        <span className="material-icons">error_outline</span>
                    </div>
                    <p className="error-message">{error}</p>
                    <div className="error-actions">
                        {!employeeData?.faceId && isUnrecognized ? (
                            <button className="reg-btn" onClick={() => onRegistrationNeeded(null)}>
                                <span className="material-icons">person_add</span>
                                Daftarkan Wajah
                            </button>
                        ) : (
                            <button onClick={() => { setError(null); isVerifyingRef.current = false; setIsVerifying(false); matchStartTime.current = null; }}>
                                Coba Lagi
                            </button>
                        )}
                        <button className="secondary-btn" onClick={() => { setError(null); isVerifyingRef.current = false; setIsVerifying(false); matchStartTime.current = null; }}>
                            Tutup
                        </button>
                    </div>
                </div>
            )}

            {isVisible && (
                <>
                    {boundingBox && (
                        <div
                            className={`face-bounding-box ${isMatching ? 'matching' : ''}`}
                            style={{
                                top: `${boundingBox.top}%`,
                                left: `${boundingBox.left}%`,
                                width: `${boundingBox.width}%`,
                                height: `${boundingBox.height}%`
                            }}
                        >
                            <div className="corner tl"></div>
                            <div className="corner tr"></div>
                            <div className="corner bl"></div>
                            <div className="corner br"></div>
                            {isMatching && matchStartTime.current && (
                                <div className="verifying-label">
                                    Verifikasi...
                                </div>
                            )}
                        </div>
                    )}

                    <div className="live-guidance">
                        <div className={`score-meter ${isMatching ? 'matching' : qualityInfo.status !== 'OK' && qualityInfo.status !== 'NO_FACE' ? qualityInfo.status.toLowerCase().replace('_', '-') : 'searching'}`}>
                            <p className="guidance-text">
                                {isMatching ? 'Wajah Terdeteksi! Sedang Mencari...' : qualityInfo.message}
                            </p>
                        </div>
                    </div>

                    <div className="pin-btn-container">
                        <button className="pin-btn" onClick={onPinClick}>
                            <span className="material-icons">dialpad</span>
                            <span>Sign Dengan PIN</span>
                        </button>
                    </div>

                    {isVerifying && (
                        <div className="verifying-overlay">
                            <div className="loader-ring"></div>
                            <p>{statusMessage}</p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default CameraPage;

import { useState, useRef, useEffect, useCallback } from 'react';
import Webcam from 'react-webcam';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { STABLE_POINTS } from '../utils/faceUtils';
import { getDeviceId } from '../utils/deviceUtils';
import { updateUserSecurity } from '../utils/apiUtils';
import { getToken } from '../utils/storageUtils';
import './FaceRegistration.css';

const STEPS = [
    { id: 'center', instruction: 'Posisikan wajah Anda di tengah lingkaran', icon: '👤' },
    { id: 'left', instruction: 'Hadapkan wajah ke kiri', icon: '👈' },
    { id: 'right', instruction: 'Hadapkan wajah ke kanan', icon: '👉' },
    { id: 'blink', instruction: 'Kedipkan mata Anda untuk verifikasi', icon: '👁️' },
    { id: 'pin', instruction: 'Buat 6 digit PIN Keamanan Anda', icon: '🔐' },
];


const FaceRegistration = ({ uniqueId, registrationStatus, onRegistrationComplete, onCancel }) => {
    const webcamRef = useRef(null);
    const [currentStep, setCurrentStep] = useState(registrationStatus?.hasFace ? 4 : 0);
    const [stepStatus, setStepStatus] = useState('pending'); // 'pending', 'detecting', 'success', 'error'
    const [notification, setNotification] = useState('');
    const [faceLandmarker, setFaceLandmarker] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [collectedLandmarks, setCollectedLandmarks] = useState([]);
    const [pin, setPin] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const animationFrameRef = useRef(null);
    const lastBlinkState = useRef(false);
    const blinkDetected = useRef(false);
    const holdTimer = useRef(null);
    const [holdProgress, setHoldProgress] = useState(0);
    const [cameraWarming, setCameraWarming] = useState(true);

    // Initialize MediaPipe Face Landmarker
    useEffect(() => {
        const initializeFaceLandmarker = async () => {
            try {
                const vision = await FilesetResolver.forVisionTasks(
                    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
                );

                const landmarker = await FaceLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath:
                            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                        delegate: 'CPU', // More stable for mobile safari than GPU
                    },
                    runningMode: 'VIDEO',
                    numFaces: 1,
                    minFaceDetectionConfidence: 0.5,
                    minFacePresenceConfidence: 0.5,
                    minTrackingConfidence: 0.5,
                    outputFaceBlendshapes: true,
                });

                setFaceLandmarker(landmarker);
            } catch (error) {
                console.error('Failed to initialize face landmarker:', error);
                setNotification('Gagal menginisialisasi deteksi wajah');
            }
        };

        initializeFaceLandmarker();

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            // Explicitly stop camera stream tracks
            if (webcamRef.current && webcamRef.current.stream) {
                webcamRef.current.stream.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    // Calculate face position relative to center using stable points
    const isFaceCentered = (landmarks) => {
        if (!landmarks || landmarks.length === 0) return false;

        // Use the centroid of stable points instead of just the nose tip
        let cx = 0, cy = 0;
        STABLE_POINTS.forEach(i => {
            cx += landmarks[i].x;
            cy += landmarks[i].y;
        });
        const faceCX = cx / STABLE_POINTS.length;
        const faceCY = cy / STABLE_POINTS.length;

        const centerX = 0.5;
        const centerY = 0.5;
        const tolerance = 0.15;

        const dx = Math.abs(faceCX - centerX);
        const dy = Math.abs(faceCY - centerY);

        return dx < tolerance && dy < tolerance;
    };

    // Check lighting by analyzing face visibility
    const isLightingGood = (landmarks, blendshapes) => {
        if (!landmarks || landmarks.length === 0) return false;

        // If we can detect face clearly with good confidence, lighting is acceptable
        // Blendshapes provide confidence in detection
        return landmarks.length >= 468;
    };

    // Detect blink using eye blendshapes
    const detectBlink = (blendshapes) => {
        if (!blendshapes || blendshapes.length === 0) return false;

        const blendshapeCategories = blendshapes[0]?.categories || [];
        const leftEyeBlink = blendshapeCategories.find(b => b.categoryName === 'eyeBlinkLeft');
        const rightEyeBlink = blendshapeCategories.find(b => b.categoryName === 'eyeBlinkRight');

        if (!leftEyeBlink || !rightEyeBlink) return false;

        const isCurrentlyBlinking = leftEyeBlink.score > 0.5 && rightEyeBlink.score > 0.5;

        // Detect transition from open to closed (actual blink)
        if (!lastBlinkState.current && isCurrentlyBlinking) {
            blinkDetected.current = true;
        }

        lastBlinkState.current = isCurrentlyBlinking;
        return blinkDetected.current;
    };

    // Detect head rotation
    const detectHeadRotation = (landmarks, direction) => {
        if (!landmarks || landmarks.length === 0) return false;

        const noseTip = landmarks[1];
        const leftEar = landmarks[234];
        const rightEar = landmarks[454];

        if (!leftEar || !rightEar) return false;

        // More robust calculation regardless of left/right coordinate values
        const minX = Math.min(leftEar.x, rightEar.x);
        const maxX = Math.max(leftEar.x, rightEar.x);
        const totalWidth = maxX - minX;

        if (totalWidth < 0.05) return false; // Ear landmarks too close or not valid

        const nosePosRatio = (noseTip.x - minX) / totalWidth;

        // Since video is mirrored in Webcam component:
        // When user turns LEFT (real world), in a mirrored view, the nose moves 
        // towards the RIGHT side of the screen (higher X value).
        if (direction === 'left') {
            return nosePosRatio > 0.65; // Swapped from < 0.35
        } else if (direction === 'right') {
            return nosePosRatio < 0.35; // Swapped from > 0.65
        }

        return false;
    };

    // Process video frame
    const processFrame = useCallback(() => {
        // Guard against processing if not in a valid state
        if (!faceLandmarker || !webcamRef.current?.video || isSubmitting || stepStatus === 'success' || cameraWarming) {
            animationFrameRef.current = requestAnimationFrame(processFrame);
            return;
        }

        if (STEPS[currentStep].id === 'pin') return;

        const video = webcamRef.current.video;
        if (video.readyState !== 4) {
            animationFrameRef.current = requestAnimationFrame(processFrame);
            return;
        }

        const startTimeMs = performance.now();
        const result = faceLandmarker.detectForVideo(video, startTimeMs);

        if (result.faceLandmarks && result.faceLandmarks.length > 0) {
            const landmarks = result.faceLandmarks[0];
            const blendshapes = result.faceBlendshapes;
            const step = STEPS[currentStep];

            if (!step || stepStatus === 'success') {
                animationFrameRef.current = requestAnimationFrame(processFrame);
                return;
            }

            setStepStatus('detecting');
            setNotification('');

            let requirementMet = false;

            switch (step.id) {
                case 'center':
                    if (isFaceCentered(landmarks)) requirementMet = true;
                    else setNotification('Geser wajah Anda ke tengah lingkaran');
                    break;
                case 'left':
                    if (detectHeadRotation(landmarks, 'left')) requirementMet = true;
                    else setNotification('Hadapkan wajah Anda ke kiri');
                    break;
                case 'right':
                    if (detectHeadRotation(landmarks, 'right')) requirementMet = true;
                    else setNotification('Hadapkan wajah Anda ke kanan');
                    break;
                case 'blink':
                    if (detectBlink(blendshapes)) requirementMet = true;
                    else setNotification('Kedipkan mata Anda');
                    break;
            }

            if (requirementMet) {
                // If this is not a blink step, require holding for 1 second
                if (step.id !== 'blink') {
                    if (!holdTimer.current) {
                        holdTimer.current = Date.now();
                    }

                    const timePassed = Date.now() - holdTimer.current;
                    setHoldProgress(Math.min(100, (timePassed / 800) * 100));

                    if (timePassed > 800) { // 800ms hold
                        completeStep(landmarks);
                    }
                } else {
                    // Blink step is instant once detected
                    completeStep(landmarks);
                }
            } else {
                holdTimer.current = null;
                setHoldProgress(0);
            }
        } else {
            if (stepStatus !== 'success') {
                setStepStatus('error');
                setNotification('Wajah tidak terdeteksi. Pastikan wajah terlihat jelas.');
                holdTimer.current = null;
                setHoldProgress(0);
            }
        }

        animationFrameRef.current = requestAnimationFrame(processFrame);
    }, [faceLandmarker, currentStep, isSubmitting, stepStatus, cameraWarming]);

    const completeStep = (landmarks) => {
        if (stepStatus === 'success') return;

        setStepStatus('success');
        setNotification('');
        setHoldProgress(100);

        // Save landmarks specifically for the 'center' step to use as reference
        if (STEPS[currentStep].id === 'center') {
            setCollectedLandmarks([landmarks]);
        } else {
            setCollectedLandmarks(prev => [...prev, landmarks]);
        }

        holdTimer.current = null;

        setTimeout(() => {
            setCurrentStep(prev => {
                const nextStep = prev + 1;
                // If we just finished blink (index 3) but PIN already exists, submit!
                if (prev === 3 && registrationStatus?.hasPin) {
                    submitFaceRegistration();
                    return prev;
                }

                if (nextStep < STEPS.length) {
                    setStepStatus('pending');
                    setNotification('');
                    setHoldProgress(0);
                    blinkDetected.current = false;
                    return nextStep;
                } else {
                    return prev;
                }
            });
        }, 1000);
    };

    const handlePinEntry = (num) => {
        if (pin.length < 6) {
            setPin(prev => prev + num);
        }
    };

    const handlePinDelete = () => {
        setPin(prev => prev.slice(0, -1));
    };

    useEffect(() => {
        if (STEPS[currentStep].id === 'pin' && pin.length === 6) {
            submitFaceRegistration();
        }
    }, [pin, currentStep]);

    // Start processing when landmarker is ready
    useEffect(() => {
        if (faceLandmarker) {
            animationFrameRef.current = requestAnimationFrame(processFrame);
        }

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [faceLandmarker, processFrame]);

    // Submit face registration to API
    const submitFaceRegistration = async () => {
        setIsSubmitting(true);
        const isPinOnly = registrationStatus?.hasFace;
        setNotification(isPinOnly ? 'Mendaftarkan PIN...' : 'Mendaftarkan wajah...');

        try {
            const token = getToken();
            if (!token) throw new Error('Token tidak ditemukan');

            const updateData = { device_id: getDeviceId() };
            const changes = [];

            // Only update faceId if we actually collected landmarks
            if (collectedLandmarks.length > 0) {
                const landmarksJson = JSON.stringify(collectedLandmarks[0]);
                updateData.faceId = btoa(landmarksJson);
                changes.push('faceId');
            }

            // Only update pin if it was entered in this session
            if (pin.length === 6) {
                updateData.pin_access = btoa(pin);
                changes.push('pin_access');
            }

            await updateUserSecurity(uniqueId, updateData);

            setNotification(isPinOnly ? 'Pendaftaran PIN berhasil!' : 'Pendaftaran wajah berhasil!');
            setTimeout(() => {
                onRegistrationComplete(changes);
            }, 1500);
        } catch (error) {
            console.error('Face registration error:', error);
            // Show the exact error message from the API if available
            const detailedError = error.message || 'Gagal mendaftarkan wajah';
            setNotification(`Error: ${detailedError}`);
            setStepStatus('error');
            setIsSubmitting(false);
        }
    };

    const videoConstraints = {
        facingMode: 'user',
        width: 640,
        height: 480,
    };

    return (
        <div className="face-registration-page">
            <div className="registration-header">
                <h1>{registrationStatus?.hasFace ? 'Pendaftaran PIN' : 'Pendaftaran Wajah'}</h1>
                <p>{registrationStatus?.hasFace ? 'Buat PIN keamanan untuk akun Anda' : 'Verifikasi wajah untuk memastikan keamanan data Anda'}</p>
            </div>

            <div className="camera-container">
                {STEPS[currentStep].id === 'pin' ? (
                    <div className="registration-pin-container">
                        <div className="pin-display-small">
                            {[...Array(6)].map((_, i) => (
                                <div key={i} className={`pin-dot ${pin.length > i ? 'active' : ''}`}></div>
                            ))}
                        </div>
                        <div className="registration-pin-pad">
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                                <button key={num} onClick={() => handlePinEntry(num.toString())} disabled={isSubmitting}>
                                    {num}
                                </button>
                            ))}
                            <div className="spacer"></div>
                            <button onClick={() => handlePinEntry('0')} disabled={isSubmitting}>0</button>
                            <button className="pin-del" onClick={handlePinDelete} disabled={isSubmitting}>
                                <span className="material-icons">backspace</span>
                            </button>
                        </div>
                    </div>
                ) : (
                    <Webcam
                        audio={false}
                        ref={webcamRef}
                        screenshotFormat="image/jpeg"
                        videoConstraints={videoConstraints}
                        className="registration-camera"
                        mirrored={true}
                        playsInline={true}
                        videoProps={{
                            playsInline: true,
                            muted: true,
                            autoPlay: true,
                        }}
                        onUserMedia={() => {
                            console.log('Registration Camera Warming Up...');
                            setTimeout(() => setCameraWarming(false), 800);
                        }}
                        onUserMediaError={(err) => {
                            setNotification('Akses kamera ditolak. Safari iOS mewajibkan HTTPS dan izin di pengaturan Safari.');
                            setStepStatus('error');
                        }}
                    />
                )}

                {STEPS[currentStep].id !== 'pin' && (
                    <div className={`face-guide-overlay ${stepStatus}`}>
                        <div className="face-circle">
                            {stepStatus === 'detecting' && holdProgress > 0 && (
                                <div className="hold-progress-ring" style={{ '--progress': `${holdProgress}%` }}></div>
                            )}
                        </div>
                    </div>
                )}

                {cameraWarming && STEPS[currentStep].id !== 'pin' && (
                    <div className="camera-warming">
                        <div className="loader-ring"></div>
                        <p>Menyiapkan Kamera...</p>
                    </div>
                )}

                {notification && (
                    <div className={`notification ${stepStatus === 'error' ? 'error' : ''}`}>
                        {notification}
                    </div>
                )}
            </div>

            {/* Steps progress */}
            <div className="steps-progress">
                {STEPS.map((step, index) => (
                    <div
                        key={step.id}
                        className={`step-item ${index < currentStep ? 'completed' :
                            index === currentStep ? 'active' : ''
                            }`}
                    >
                        <div className="step-icon">{step.icon}</div>
                        <div className="step-number">{index + 1}</div>
                    </div>
                ))}
            </div>

            {/* Current step instruction */}
            <div className="current-instruction">
                <p><strong>Langkah {currentStep + 1}:</strong> {STEPS[currentStep]?.instruction || 'Memproses...'}</p>
            </div>

            {/* Cancel button */}
            <button className="cancel-btn" onClick={onCancel} disabled={isSubmitting}>
                Batal
            </button>
        </div>
    );
};

export default FaceRegistration;

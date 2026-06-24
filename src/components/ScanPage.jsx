import { useEffect, useState, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { verifyQrCode } from '../utils/apiUtils';
import LocationCheck from './LocationCheck';
import './ScanPage.css';

const ScanPage = () => {
    const [scanResult, setScanResult] = useState(null);
    const [isVerifying, setIsVerifying] = useState(false);
    const [error, setError] = useState(null);
    const scannerRef = useRef(null);

    // Get date string YYYY-MM-DD
    const getTodayDateString = () => {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // Handle bypass logic
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const bypass = params.get('bypass');
        const callbackUri = params.get('callback_uri');

        if (bypass) {
            try {
                // Decode bypass param (same logic as QR decode)
                let jsonString = atob(bypass);
                console.log("Bypass Raw String:", jsonString);

                // Robust fix for unquoted keys
                const fixedJson = jsonString.replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3');
                const qrData = JSON.parse(fixedJson);

                console.log("Bypass Decoded Data:", qrData);

                // Save to sessionStorage
                sessionStorage.setItem('scanned_qr_data', JSON.stringify(qrData));

                // Save callback URI if present
                if (callbackUri) {
                    sessionStorage.setItem('auth_callback_uri', callbackUri);
                }

                // Redirect to start auth flow
                window.location.href = '/';
            } catch (e) {
                console.error("Bypass failed:", e);
                setError("Parameter bypass tidak valid.");
            }
        }
    }, []);

    useEffect(() => {

        const startScanner = async () => {
            try {
                const html5QrCode = new Html5Qrcode("reader");
                scannerRef.current = html5QrCode;

                const qrCodeSuccessCallback = async (decodedText, decodedResult) => {
                    console.log(`Code matched = ${decodedText}`, decodedResult);

                    // Stop scanning immediately to prevent duplicate calls
                    await html5QrCode.stop().catch(console.error);

                    setIsVerifying(true);
                    setError(null);

                    try {
                        // 1. Decode Base64 to JSON string
                        let qrData;
                        try {
                            let jsonString = atob(decodedText);
                            console.log("Raw Decoded String:", jsonString);

                            // Robust fix for unquoted keys (e.g., min: 10, max: 15 -> "min": 10, "max": 15)
                            // This regex finds word keys preceding a colon that aren't already quoted
                            const fixedJson = jsonString.replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3');

                            qrData = JSON.parse(fixedJson);
                            console.log("Decoded QR Data:", qrData);

                            // 2. Save to sessionStorage
                            sessionStorage.setItem('scanned_qr_data', JSON.stringify(qrData));
                        } catch (e) {
                            console.error("Failed to decode or parse QR data:", e);
                            throw new Error("Format QR Code tidak valid (Base64/JSON error).");
                        }

                        // 3. Verification Logic (kept as original, using raw text for backend check)
                        // await verifyQrCode(decodedText);

                        setScanResult(decodedText);

                        // 4. Success Redirect (no parameters needed anymore)
                        window.location.href = '/';

                    } catch (err) {
                        console.error("Verification failed", err);
                        setError(err.message || "QR Code tidak valid.");
                        setIsVerifying(false);

                        // No automatic restart here to avoid "reader not found" race conditions
                        // User can click "Coba Lagi" or the scanner will stay stopped
                    }
                };

                const config = {
                    fps: 10,
                    qrbox: { width: 250, height: 250 },
                    aspectRatio: 1.0
                };

                // Request camera with 'facingMode: "environment"' for back camera
                await html5QrCode.start(
                    { facingMode: "environment" },
                    config,
                    qrCodeSuccessCallback
                );

            } catch (err) {
                console.error("Error starting scanner", err);
                setError("Gagal mengakses kamera. Pastikan izin kamera diberikan.");
            }
        };

        // Initialize scanner
        startScanner();

        return () => {
            if (scannerRef.current) {
                if (scannerRef.current.isScanning) {
                    scannerRef.current.stop().catch(console.error);
                }
            }
        };
    }, []);

    // We use a single return and use conditional CSS/content instead of 
    // replacing the whole DOM structure to keep the "reader" element alive

    return (
        <div className="scan-page">
            <div className="scan-container">
                <div className="scan-header">
                    <h3>Scan QR Code</h3>
                    <p>{isVerifying ? 'Memverifikasi...' : 'Arahkan kamera ke QR Code lokasi'}</p>
                </div>

                <div className="scanner-frame">
                    <div id="reader" className="scanner-video"></div>

                    {error && !isVerifying && (
                        <div className="scan-error-overlay">
                            <span className="material-icons">error_outline</span>
                            <p>{error}</p>
                            <button onClick={() => window.location.reload()}>Coba Lagi</button>
                        </div>
                    )}

                    {isVerifying && (
                        <div className="verifying-overlay-compact">
                            <div className="loader-ring-small"></div>
                        </div>
                    )}

                    {!scanResult && !isVerifying && !error && (
                        <div className="scan-overlay">
                            <div className="scan-region-highlight">
                                <div className="scan-laser"></div>
                            </div>
                        </div>
                    )}
                </div>

                {error && (
                    <div className="error-message-toast">
                        {error}
                    </div>
                )}

                <div className="scanner-footer">
                    <p>Alkaysan Attendance System</p>
                </div>
            </div>
        </div>
    );
};

export default ScanPage;

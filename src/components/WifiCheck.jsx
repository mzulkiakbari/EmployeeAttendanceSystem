import { useState, useEffect } from 'react';
import { isOfficeNetwork } from '../utils/networkUtils';
import './WifiCheck.css';

const WifiCheck = ({ branchName, onVerified, onBackToGPS, showNotification }) => {
    const [isChecking, setIsChecking] = useState(true);
    const [errorCount, setErrorCount] = useState(0);

    useEffect(() => {
        const checkInterval = setInterval(async () => {
            console.log(`Real-time WiFi Check: verifying connection for ${branchName || 'Kantor'}...`);
            const isOffice = await isOfficeNetwork(branchName);

            if (isOffice) {
                clearInterval(checkInterval);
                setIsChecking(false);
                showNotification(`Terhubung ke WiFi ${branchName || 'Kantor'}. Terverifikasi!`, 'success');
                setTimeout(() => onVerified(branchName || 'Office'), 1000);
            } else {
                setErrorCount(prev => prev + 1);
                // Frequency: Every ~12 seconds (4 cycles * 3s)
                if (errorCount > 0 && errorCount % 4 === 0) {
                    showNotification(`Anda harus menghubungkan jaringan anda dengan Wifi ${branchName || 'Kantor'}`, 'warning');
                }
            }
        }, 3000); // Check every 3 seconds for "real-time" feel

        return () => clearInterval(checkInterval);
    }, [branchName, onVerified, showNotification, errorCount]);

    return (
        <div className="wifi-check-overlay">
            <div className="wifi-card">
                <div className="wifi-animation-container">
                    <div className="wifi-wave wave-1"></div>
                    <div className="wifi-wave wave-2"></div>
                    <div className="wifi-wave wave-3"></div>
                    <div className="wifi-icon-box">
                        <span className="material-icons">wifi</span>
                    </div>
                </div>

                <div className="wifi-info">
                    <h2>Verifikasi WiFi Kantor</h2>
                    <p className="branch-highlight">{branchName || 'Kantor'}</p>
                    <p className="status-text">
                        {isChecking ? 'Menunggu koneksi ke WiFi kantor...' : 'WiFi Terverifikasi!'}
                    </p>
                    <div className="scanning-bar">
                        <div className="scanning-progress"></div>
                    </div>
                </div>

                <div className="wifi-actions">
                    <button className="primary-btn" onClick={() => window.location.reload()}>
                        <span className="material-icons">refresh</span>
                        Cek Sekarang
                    </button>
                    <button className="secondary-btn" onClick={onBackToGPS}>
                        <span className="material-icons">location_on</span>
                        Coba GPS
                    </button>
                </div>

                <p className="instruction-text">
                    Buka pengaturan WiFi di ponsel Anda dan hubungkan ke jaringan yang tersedia di {branchName || 'Kantor'}.
                </p>
            </div>
        </div>
    );
};

export default WifiCheck;

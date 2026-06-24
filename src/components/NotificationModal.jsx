import { useEffect, useState } from 'react';
import './NotificationModal.css';

const NotificationModal = ({ message, type = 'error', onClose, duration = 5000 }) => {
    const [progress, setProgress] = useState(100);

    useEffect(() => {
        const startTime = Date.now();
        const endTime = startTime + duration;

        const interval = setInterval(() => {
            const now = Date.now();
            const remaining = Math.max(0, endTime - now);
            const percentage = (remaining / duration) * 100;
            setProgress(percentage);

            if (percentage <= 0) {
                clearInterval(interval);
                onClose();
            }
        }, 50);

        return () => clearInterval(interval);
    }, [duration, onClose]);

    const getIcon = () => {
        switch (type) {
            case 'success': return 'check_circle';
            case 'warning': return 'warning';
            case 'info': return 'info';
            default: return 'error_outline';
        }
    };

    return (
        <div className="notification-overlay">
            <div className={`notification-card ${type}`}>
                <div className="notification-content">
                    <div className="notification-icon-box">
                        <span className="material-icons">{getIcon()}</span>
                    </div>
                    <div className="notification-text">
                        <h3>{type === 'error' ? 'Akses Ditolak' : 'Notifikasi'}</h3>
                        <p>{message}</p>
                    </div>
                    <button className="notification-close-btn" onClick={onClose}>
                        <span className="material-icons">close</span>
                    </button>
                </div>
                <div className="notification-progress-container">
                    <div
                        className="notification-progress-bar"
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>
            </div>
        </div>
    );
};

export default NotificationModal;

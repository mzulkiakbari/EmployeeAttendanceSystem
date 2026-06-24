import { useState, useEffect } from 'react';
import { updateUserSecurity, saveOfflineAttendance } from '../utils/apiUtils';
import { getDeviceId } from '../utils/deviceUtils';
import './PinPage.css';

const PinPage = ({ onVerificationComplete, onCancel, employeeData, isAlreadySigned }) => {
    const [pin, setPin] = useState('');
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [statusMessage, setStatusMessage] = useState('Memproses...');

    const handleNumberClick = (num) => {
        if (pin.length < 6) {
            setPin(prev => prev + num);
        }
    };

    const handleDelete = () => {
        setPin(prev => prev.slice(0, -1));
    };

    const handleSubmit = async () => {
        if (pin.length < 6 || isSubmitting) return;

        setIsSubmitting(true);
        setError(null);
        setStatusMessage('Memverifikasi PIN...');

        try {
            const currentDeviceId = getDeviceId();
            const encryptedInput = btoa(pin);

            // 1. Verify PIN Match with Employee Data
            if (!employeeData || !employeeData.pin_access) {
                throw new Error('PIN belum diatur untuk akun ini.');
            }

            if (employeeData.pin_access !== encryptedInput) {
                throw new Error('PIN Salah. Silakan coba lagi.');
            }

            setStatusMessage(`Validasi perangkat: ${employeeData.nama_depan_karyawan}...`);

            // 2. Already signed today check - Removed


            // 3. Device validation
            const isLegacyDevice = employeeData.device_id && employeeData.device_id.length !== 32;
            if (employeeData.device_id && employeeData.device_id !== currentDeviceId && !isLegacyDevice) {
                saveOfflineAttendance({
                    userId: employeeData.uniqueId,
                    deviceId: currentDeviceId,
                    pin: pin,
                    status: 'PENDING_RESET'
                });
                throw new Error(`Anda tidak dapat sign menggunakan device lain. Hubungi Admin untuk reset.`);
            }

            // 5. Update device_id if missing or migrating from legacy format
            if (!employeeData.device_id || (isLegacyDevice && employeeData.device_id !== currentDeviceId)) {
                await updateUserSecurity(employeeData.uniqueId, {
                    device_id: currentDeviceId
                });
            }

            // Notify App of success - WAIT for submission
            await onVerificationComplete({
                ...employeeData,
                time: new Date().toLocaleTimeString('id-ID'),
                sign_with: 'pin'
            });
        } catch (err) {
            console.error('PIN Attendance error:', err);
            setError(err.message);
            setIsSubmitting(false);
            setPin(''); // Reset PIN on error
        }
    };

    useEffect(() => {
        if (pin.length === 6) {
            handleSubmit();
        }
    }, [pin]);

    return (
        <div className="pin-page">
            <div className="pin-container">
                <div className="pin-header">
                    <h1>Masukkan PIN</h1>
                    <p className="pin-detail">Gunakan 6 digit PIN Anda untuk absensi</p>
                </div>

                <div className="pin-display">
                    {[...Array(6)].map((_, i) => (
                        <div key={i} className={`pin-dot ${pin.length > i ? 'active' : ''}`}></div>
                    ))}
                </div>

                {error && <div className="pin-error">{error}</div>}

                <div className="pin-keypad">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                        <button key={num} onClick={() => handleNumberClick(num.toString())} disabled={isSubmitting}>
                            {num}
                        </button>
                    ))}
                    <button className="pin-key-back" onClick={onCancel} disabled={isSubmitting}>
                        <span className="material-icons">close</span>
                    </button>
                    <button onClick={() => handleNumberClick('0')} disabled={isSubmitting}>0</button>
                    <button className="pin-key-del" onClick={handleDelete} disabled={isSubmitting}>
                        <span className="material-icons">backspace</span>
                    </button>
                </div>
            </div>

            {isSubmitting && (
                <div className="verifying-overlay">
                    <div className="loader-ring"></div>
                    <p>{statusMessage}</p>
                </div>
            )}
        </div>
    );
};

export default PinPage;

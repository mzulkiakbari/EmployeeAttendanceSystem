import { useEffect, useState } from 'react';
import './AuthCallback.css';
import { setToken, setRefreshToken, getToken } from '../utils/storageUtils';

const AuthCallback = ({ onAuthComplete }) => {
    const [status, setStatus] = useState('processing');
    const [message, setMessage] = useState('Memproses autentikasi...');

    useEffect(() => {
        const processCallback = async () => {
            try {
                // Get authorization code from URL params
                const urlParams = new URLSearchParams(window.location.search);
                const code = urlParams.get('code');

                if (code) {
                    setMessage('Mengambil token...');

                    // Exchange authorization code for access token
                    const tokenRes = await fetch(
                        "https://account.alkaysan.co.id/oauth/token",
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/x-www-form-urlencoded",
                            },
                            body: new URLSearchParams({
                                client_id: import.meta.env.VITE_ALKAYSAN_SSO_CLIENT_ID,
                                client_secret: import.meta.env.VITE_ALKAYSAN_SSO_CLIENT_SECRET,
                                redirect_uri: import.meta.env.VITE_ALKAYSAN_SSO_REDIRECT_URI,
                                grant_type: "authorization_code",
                                code: code,
                            }),
                        }
                    );

                    if (!tokenRes.ok) {
                        throw new Error('Gagal mendapatkan access token.');
                    }

                    const tokenData = await tokenRes.json();

                    if (tokenData.access_token) {
                        setToken(tokenData.access_token);
                        if (tokenData.refresh_token) {
                            setRefreshToken(tokenData.refresh_token);
                        }

                        setStatus('success');
                        setMessage('Login berhasil! Mengalihkan...');

                        // Clear URL params and reset path to root
                        window.history.replaceState({}, document.title, '/');

                        setTimeout(() => {
                            onAuthComplete({
                                access_token: tokenData.access_token,
                                refresh_token: tokenData.refresh_token
                            });
                        }, 1500);
                    } else {
                        throw new Error('Token tidak ditemukan dalam response.');
                    }
                } else {
                    // Check if token already exists in localStorage or cookies
                    const existingToken = getToken();
                    if (existingToken) {
                        setStatus('success');
                        setMessage('Sesi ditemukan! Mengalihkan...');
                        setTimeout(() => {
                            onAuthComplete({ access_token: existingToken });
                        }, 1000);
                    } else {
                        setStatus('error');
                        setMessage('Authorization code tidak ditemukan. Silakan login ulang.');
                    }
                }
            } catch (error) {
                console.error('Auth callback error:', error);
                setStatus('error');
                setMessage(error.message || 'Terjadi kesalahan saat memproses autentikasi.');
            }
        };

        // Safety timeout to prevent getting stuck forever
        const safetyTimeout = setTimeout(() => {
            if (status === 'processing' || message.includes('Mengalihkan')) {
                setStatus('error');
                setMessage('Waktu tunggu habis. Silakan coba login kembali.');
            }
        }, 15000); // 15 seconds max wait

        processCallback();

        return () => clearTimeout(safetyTimeout);
    }, [onAuthComplete]);

    return (
        <div className="auth-callback-page">
            <div className="auth-callback-container">
                {status === 'processing' && (
                    <div className="auth-loader">
                        <div className="spinner"></div>
                    </div>
                )}

                {status === 'success' && (
                    <div className="auth-success-icon">
                        <span className="material-icons">check_circle</span>
                    </div>
                )}

                {status === 'error' && (
                    <div className="auth-error-icon">
                        <span className="material-icons">error</span>
                    </div>
                )}

                <p className="auth-message">{message}</p>

                {status === 'error' && (
                    <button
                        className="retry-login-btn"
                        onClick={() => window.location.href = '/'}
                    >
                        Kembali ke Login
                    </button>
                )}
            </div>
        </div>
    );
};

export default AuthCallback;

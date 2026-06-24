import { AlkaysanLogin } from '@noonor/alkaysan-one';
import './LoginPage.css';

const LoginPage = () => {
    return (
        <div className="login-page">
            <div className="login-container">
                <div className="login-header">
                    <div className="logo-icon">
                        <span className="material-icons">public</span>
                    </div>
                    <h1>Attendance System</h1>
                    <p>Silakan login untuk melanjutkan</p>
                </div>

                <div className="oauth-container">
                    <AlkaysanLogin
                        theme="filled_light"
                        shape="pill"
                        size="large"
                        type="button"
                        mode="redirect"
                    />
                </div>

                <div className="login-footer">
                    <p>© 2026 Alkaysan. All rights reserved.</p>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;

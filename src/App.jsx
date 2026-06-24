import { useState, useEffect } from 'react';
import CameraPage from './components/CameraPage';
import ScanPage from './components/ScanPage';
import FaceRegistration from './components/FaceRegistration';
import PinPage from './components/PinPage';
import LoginPage from './components/LoginPage';
import AuthCallback from './components/AuthCallback';
import LocationCheck from './components/LocationCheck';
import NotificationModal from './components/NotificationModal';
import WifiCheck from './components/WifiCheck';
import { fetchUserProfile, submitAttendance, updateUserSecurity } from './utils/apiUtils';
import { getOSName, getDeviceId } from './utils/deviceUtils';
import { getCookie } from './utils/datetimeUtils';
import { isOfficeNetwork } from './utils/networkUtils';
import { getToken, clearTokens } from './utils/storageUtils';
import './App.css';

const validateEmployeeBranch = (profile, qrBranch) => {
  if (!qrBranch) return true;
  if (!profile.branches || profile.branches.length === 0) return true;

  return profile.branches.some(b =>
    b.storeName && b.storeName.toLowerCase() === qrBranch.toLowerCase()
  );
};

/**
 * Centrally handles the flow after location is verified (either GPS or WiFi).
 * Performs: Branch Validation -> Device Registration -> Registration Check -> Page Navigation.
 */
const completeVerificationFlow = async ({
  profile,
  branchName,
  states,
  helpers
}) => {
  const { setEmployeeData, setIsAuthenticated, setCurrentPage, setIsAlreadySigned, setUniqueId, setRegistrationStartTime, setRegistrationStatus } = states;
  const { showNotification, validateEmployeeBranch, updateUserSecurity, getDeviceId } = helpers;

  // 1. Branch Validation (CRITICAL: Must be first)
  if (!validateEmployeeBranch(profile, branchName)) {
    const allowedBranches = profile.branches?.map(b => b.storeName).join(', ') || 'None';
    showNotification(`Akses Ditolak: Anda hanya boleh absen di cabang: ${allowedBranches}`, 'error');
    sessionStorage.removeItem('scanned_qr_data');
    setCurrentPage('scan');
    return false;
  }

  // 2. Auto-register Device ID if missing
  if (!profile.device_id) {
    try {
      const currentDeviceId = getDeviceId();
      await updateUserSecurity(profile.uniqueId, { device_id: currentDeviceId });
      profile.device_id = currentDeviceId;
      console.log('Device ID auto-registered during flow:', currentDeviceId);
    } catch (devErr) {
      console.error('Failed to auto-register device ID:', devErr);
    }
  }

  // 3. Set global auth states
  setEmployeeData(profile);
  setIsAuthenticated(true);

  // 4. Daily sign status check
  const today = new Date().toDateString();
  if (localStorage.getItem(`signed_${profile.uniqueId}_${today}`)) {
    setIsAlreadySigned(true);
  }

  // 5. Path determination (Face/PIN registration check)
  if (!profile.faceId || !profile.pin_access) {
    setUniqueId(profile.uniqueId);
    setRegistrationStatus({
      hasFace: !!profile.faceId,
      hasPin: !!profile.pin_access
    });
    setRegistrationStartTime(new Date());
    setCurrentPage('registration');
  } else {
    setCurrentPage('camera');
  }

  return true;
};

function App() {
  const [currentPage, setCurrentPage] = useState('loading'); // 'loading', 'login', 'auth_callback', 'camera', 'pin', 'registration', 'success', 'time_error', 'location_error'
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [uniqueId, setUniqueId] = useState(null);
  const [employeeData, setEmployeeData] = useState(null);
  const [countdown, setCountdown] = useState(3);
  const [registrationStartTime, setRegistrationStartTime] = useState(null);
  const [isAlreadySigned, setIsAlreadySigned] = useState(false);
  const [locationName, setLocationName] = useState('');
  const [notification, setNotification] = useState(null); // { message, type, action }
  const [registrationStatus, setRegistrationStatus] = useState({ hasFace: false, hasPin: false });

  const showNotification = (message, type = 'error', action = null) => {
    setNotification({ message, type, action });
  };

  // Check authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const token = getToken();
      const code = urlParams.get('code');

      if (code) {
        setCurrentPage('auth_callback');
      } else {
        const hasScanData = sessionStorage.getItem('scanned_qr_data');
        if (hasScanData) {
          try {
            const data = JSON.parse(hasScanData);
            const qrBranch = data.branch || 'Office';
            setLocationName(qrBranch);

            if (token) {
              try {
                let profile = await fetchUserProfile();

                // BYPASS MODE: Skip location/WiFi verification when callback_uri is present
                const isBypassMode = !!sessionStorage.getItem('auth_callback_uri');
                if (isBypassMode) {
                  console.log('Bypass mode detected. Skipping location verification.');
                  setEmployeeData(profile);
                  setIsAuthenticated(true);

                  if (!profile.faceId || !profile.pin_access) {
                    setUniqueId(profile.uniqueId);
                    setRegistrationStatus({
                      hasFace: !!profile.faceId,
                      hasPin: !!profile.pin_access
                    });
                    setCurrentPage('registration');
                  } else {
                    // Already registered, redirect to callback
                    const callbackUri = sessionStorage.getItem('auth_callback_uri');
                    sessionStorage.removeItem('auth_callback_uri');
                    if (callbackUri) {
                      window.location.href = callbackUri;
                    } else {
                      setCurrentPage('camera');
                    }
                  }
                  return;
                }

                // 1. Branch Validation (Must come first)
                if (!validateEmployeeBranch(profile, qrBranch)) {
                  const allowedBranches = profile.branches?.map(b => b.storeName).join(', ') || 'None';
                  showNotification(`Akses Ditolak: Anda hanya boleh absen di cabang: ${allowedBranches}`, 'error');
                  sessionStorage.removeItem('scanned_qr_data');
                  setCurrentPage('scan');
                  return;
                }

                // 2. WiFi Bypass (Branch-specific)
                const isOffice = await isOfficeNetwork(qrBranch);
                if (isOffice) {
                  console.log(`Office WiFi detected for ${qrBranch}. Bypassing GPS.`);
                  await completeVerificationFlow({
                    profile,
                    branchName: qrBranch,
                    states: { setEmployeeData, setIsAuthenticated, setCurrentPage, setIsAlreadySigned, setUniqueId, setRegistrationStartTime, setRegistrationStatus },
                    helpers: { showNotification, validateEmployeeBranch, updateUserSecurity, getDeviceId }
                  });
                  return;
                }

                // Not on office WiFi
                setCurrentPage('location_check');
              } catch (e) {
                console.error('Bypass fetch/flow failed:', e);
                if (e.message === 'SESI_BERAKHIR' || e.message === 'NOT_LOGGED_IN') {
                  clearTokens();
                }
                setCurrentPage('login');
              }
            } else {
              setCurrentPage('login');
            }
          } catch (err) {
            console.error('Scan data parse error:', err);
            setCurrentPage('scan');
          }
        } else {
          setCurrentPage('scan');
        }
      }
    };

    checkAuth();
  }, []);

  const handleAuthComplete = async (tokens) => {
    try {
      let profile = await fetchUserProfile();

      // BYPASS MODE: Skip location verification after login
      const isBypassMode = !!sessionStorage.getItem('auth_callback_uri');
      if (isBypassMode) {
        console.log('Bypass mode (post-login). Skipping location verification.');
        setEmployeeData(profile);
        setIsAuthenticated(true);

        if (!profile.faceId || !profile.pin_access) {
          setUniqueId(profile.uniqueId);
          setRegistrationStatus({
            hasFace: !!profile.faceId,
            hasPin: !!profile.pin_access
          });
          setCurrentPage('registration');
        } else {
          const callbackUri = sessionStorage.getItem('auth_callback_uri');
          sessionStorage.removeItem('auth_callback_uri');
          if (callbackUri) {
            window.location.href = callbackUri;
          } else {
            setCurrentPage('camera');
          }
        }
        return;
      }

      // Use consolidated flow helper
      const hasScanData = sessionStorage.getItem('scanned_qr_data');
      let branchName = 'Office';
      if (hasScanData) {
        try {
          const scanData = JSON.parse(hasScanData);
          branchName = scanData.branch || 'Office';
        } catch (e) { }
      }

      await completeVerificationFlow({
        profile,
        branchName,
        states: { setEmployeeData, setIsAuthenticated, setCurrentPage, setIsAlreadySigned, setUniqueId, setRegistrationStartTime, setRegistrationStatus },
        helpers: { showNotification, validateEmployeeBranch, updateUserSecurity, getDeviceId }
      });
    } catch (err) {
      console.error('Profile fetch error in handleAuthComplete:', err);
      if (err.message === 'SESI_BERAKHIR' || err.message === 'NOT_LOGGED_IN') {
        // Clear token to prevent infinite loop if token is bad
        clearTokens();
      }
      setCurrentPage('login');
    }
  };

  const handleRegistrationNeeded = (id) => {
    setUniqueId(id);
    setCurrentPage('registration');
  };

  const handleRegistrationComplete = async (changes = []) => {
    try {
      const profile = await fetchUserProfile();

      // BYPASS MODE: Redirect to callback_uri immediately after registration
      const callbackUri = sessionStorage.getItem('auth_callback_uri');
      if (callbackUri) {
        console.log('Bypass mode: Registration complete. Redirecting to callback_uri.');
        sessionStorage.removeItem('auth_callback_uri');
        sessionStorage.removeItem('scanned_qr_data');

        let finalUrl = callbackUri;
        if (changes && changes.length > 0) {
          const separator = finalUrl.includes('?') ? '&' : '?';
          finalUrl += `${separator}dataChange=${changes.join(',')}`;
        }

        window.location.href = finalUrl;
        return;
      }

      // Branch Validation (if scan data exists)
      const hasScanData = sessionStorage.getItem('scanned_qr_data');
      if (hasScanData) {
        try {
          const scanData = JSON.parse(hasScanData);
          if (!validateEmployeeBranch(profile, scanData.branch)) {
            const allowedBranches = profile.branches?.map(b => b.storeName).join(', ') || 'None';
            showNotification(`Akses Ditolak: Anda hanya boleh absen di cabang: ${allowedBranches}`, 'error');
            sessionStorage.removeItem('scanned_qr_data');
            setCurrentPage('scan');
            return;
          }
        } catch (e) {
          console.error('Validation error on registration complete:', e);
        }
      }

      if (!profile.faceId) {
        showNotification('Data wajah belum sinkron. Silakan coba masuk ke kamera lagi dalam beberapa saat.', 'warning');
        return;
      }

      setEmployeeData(profile);
      setCurrentPage('camera');
    } catch (err) {
      console.error('Post-registration profile fetch error:', err);
      if (err.message === 'SESI_BERAKHIR' || err.message === 'NOT_LOGGED_IN') {
        clearTokens();
        setCurrentPage('login');
        return;
      }
      setCurrentPage('camera');
    }
  };

  const handleVerificationComplete = async (data) => {
    console.log('Attendance data verified:', data);

    try {
      // Use time from cookie if available, otherwise fallback to current
      const storedSignTime = getCookie('signtime');

      let signTime;
      let formattedTime;

      if (storedSignTime) {
        formattedTime = storedSignTime;
        signTime = new Date(storedSignTime.replace(/-/g, '/')); // Handle Safari parsing if needed
        console.log('Using signtime from cookie:', formattedTime);
      } else {
        signTime = registrationStartTime || new Date();
        const year = signTime.getFullYear();
        const month = String(signTime.getMonth() + 1).padStart(2, '0');
        const day = String(signTime.getDate()).padStart(2, '0');
        const hours = String(signTime.getHours()).padStart(2, '0');
        const minutes = String(signTime.getMinutes()).padStart(2, '0');
        const seconds = String(signTime.getSeconds()).padStart(2, '0');
        formattedTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        console.log('No signtime cookie found, using current time:', formattedTime);
      }

      // Time-based Attendance Type Logic
      const currentHour = signTime.getHours();
      let type = 'present';

      // BLOCKING LOGIC: If already "go_home", block until 06:00 next day
      const lastTypeCheck = localStorage.getItem(`last_type_${data.uniqueId}`);
      if (lastTypeCheck === 'go_home' && (currentHour >= 15 || currentHour < 6)) {
        showNotification("Anda tidak dapat sign masuk sekarang. Sign masuk bisa dilakukan setelah pukul 6 pagi.", "warning");
        setCurrentPage('camera'); // Go back to camera
        setCountdown(3);
        return; // Stop submission
      }

      // 1. Present Phase (06:00 - 15:00)
      if (currentHour >= 6 && currentHour < 15) {
        type = 'present';
      }
      // 2. Go Home Phase (15:00 - 19:00)
      else if (currentHour >= 15 && currentHour < 19) {
        type = 'go_home';
      }
      // 3. Overtime Phase (19:00 - 06:00 next day)
      else {
        // Toggle logic based on last attendance
        const lastType = localStorage.getItem(`last_type_${data.uniqueId}`);
        if (lastType === 'overtimein') {
          type = 'go_home';
        } else {
          type = 'overtimein';
        }
      }

      console.log(`Determined Attendance Type: ${type} (Hour: ${currentHour})`);

      await submitAttendance({
        uniqueId: data.uniqueId,
        type: type,
        deviceName: getOSName(),
        location: locationName,
        time: formattedTime,
        sign_with: data.sign_with
      });

      console.log('Attendance submitted successfully');

      // Mark as signed today and persist type
      const today = new Date().toDateString();
      localStorage.setItem(`signed_${data.uniqueId}_${today}`, 'true');
      localStorage.setItem(`last_type_${data.uniqueId}`, type);
      setIsAlreadySigned(true);

      setEmployeeData({
        ...data,
        time: signTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      });
      setCurrentPage('success');
      setCountdown(3);
      setRegistrationStartTime(null); // Reset after use

    } catch (err) {
      console.error('Failed to submit attendance:', err);
      // Even if API fails, we generally might want to show success locally or show specific error?
      // For now, let's treat it as a flow interruption or maybe fallback
      showNotification(`Gagal mengirim absensi: ${err.message}`, 'error'); // REPLACED ALERT
    }
  };

  // Auto-close success page
  useEffect(() => {
    let timer;
    if (currentPage === 'success' && countdown > 0) {
      timer = setInterval(() => {
        setCountdown(prev => prev - 1);
      }, 1000);
    } else if (currentPage === 'success' && countdown === 0) {
      try {
        window.close();
      } catch (e) {
        setCurrentPage('camera');
      }
    }
    return () => clearInterval(timer);
  }, [currentPage, countdown]);

  return (
    <div className="app">
      {currentPage === 'loading' && (
        <div className="loading-screen-premium">
          <div className="loading-card">
            <div className="logo-section">
              <div className="logo-blob"></div>
              <span className="material-icons main-icon">security</span>
            </div>
            <h2>Menyiapkan Sistem...</h2>
            <p>Memverifikasi keamanan dan memuat data kehadiran.</p>
            <div className="loading-bar-container">
              <div className="loading-bar-fill"></div>
            </div>
          </div>
        </div>
      )}

      {currentPage === 'login' && (
        <LoginPage />
      )}

      {currentPage === 'location_check' && (
        <LocationCheck
          showNotification={showNotification}
          onGoToWifiCheck={() => setCurrentPage('wifi_check')}
          onVerified={async (branchName) => {
            setLocationName(branchName);

            const token = getToken();
            if (!token) {
              setCurrentPage('login');
              return;
            }

            // If token exists, now fetch profile data
            try {
              let profile = await fetchUserProfile();

              await completeVerificationFlow({
                profile,
                branchName,
                states: { setEmployeeData, setIsAuthenticated, setCurrentPage, setIsAlreadySigned, setUniqueId, setRegistrationStartTime, setRegistrationStatus },
                helpers: { showNotification, validateEmployeeBranch, updateUserSecurity, getDeviceId }
              });
            } catch (err) {
              console.error('Deferred profile fetch failed:', err);
              showNotification(`Gagal mengambil data profil: ${err.message}`, 'error');
              if (err.message === 'SESI_BERAKHIR' || err.message === 'NOT_LOGGED_IN') {
                clearTokens();
              }
              setCurrentPage('login');
            }
          }}
        />
      )}

      {currentPage === 'wifi_check' && (
        <WifiCheck
          branchName={locationName}
          showNotification={showNotification}
          onBackToGPS={() => setCurrentPage('location_check')}
          onVerified={async (branchName) => {
            // Re-use same verification logic as LocationCheck
            setLocationName(branchName);
            const token = getToken();
            if (!token) {
              setCurrentPage('login');
              return;
            }
            try {
              let profile = await fetchUserProfile();
              await completeVerificationFlow({
                profile,
                branchName,
                states: { setEmployeeData, setIsAuthenticated, setCurrentPage, setIsAlreadySigned, setUniqueId, setRegistrationStartTime, setRegistrationStatus },
                helpers: { showNotification, validateEmployeeBranch, updateUserSecurity, getDeviceId }
              });
            } catch (err) {
              console.error('WiFi verified but profile fetch failed:', err);
              showNotification(`Gagal mengambil data profil (WiFi): ${err.message}`, 'error');
              if (err.message === 'SESI_BERAKHIR' || err.message === 'NOT_LOGGED_IN') {
                clearTokens();
              }
              setCurrentPage('login');
            }
          }}
        />
      )}

      {currentPage === 'auth_callback' && (
        <AuthCallback onAuthComplete={handleAuthComplete} />
      )}

      {currentPage === 'scan' && (
        <ScanPage />
      )}

      {isAuthenticated && (
        <>
          {currentPage === 'camera' && (
            <CameraPage
              isVisible={true}
              employeeData={employeeData}
              isAlreadySigned={isAlreadySigned}
              onVerificationComplete={handleVerificationComplete}
              onRegistrationNeeded={handleRegistrationNeeded}
              onPinClick={() => setCurrentPage('pin')}
            />
          )}

          {currentPage === 'pin' && (
            <PinPage
              employeeData={employeeData}
              isAlreadySigned={isAlreadySigned}
              onVerificationComplete={handleVerificationComplete}
              onCancel={() => setCurrentPage('camera')}
            />
          )}

          {currentPage === 'registration' && (
            <FaceRegistration
              uniqueId={uniqueId}
              registrationStatus={registrationStatus}
              onRegistrationComplete={handleRegistrationComplete}
              onCancel={() => {
                setUniqueId(null);
                setCurrentPage('camera');
              }}
            />
          )}

          {currentPage === 'success' && (
            <div className="success-page">
              <div className="success-content">
                <div className="success-animation">
                  <div className="success-ring"></div>
                  <span className="material-icons success-icon-main">check_circle</span>
                </div>
                <h1>Absensi Berhasil!</h1>

                <div className="attendance-info">
                  <p className="attendance-date">{new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                  <p className="attendance-time">{employeeData?.time || new Date().toLocaleTimeString('id-ID')}</p>
                </div>

                <div className="employee-details">
                  <p className="emp-name">{employeeData?.nama_depan_karyawan} {employeeData?.nama_belakang_karyawan}</p>
                  <p className="emp-email">{employeeData?.email}</p>
                </div>

                <div className="countdown-container">
                  <p>Data sudah terkirim, silahkan tutup halaman ini.</p>
                </div>

                <button className="done-btn" onClick={() => setCurrentPage('camera')}>
                  Selesai
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {notification && (
        <NotificationModal
          message={notification.message}
          type={notification.type}
          onClose={() => {
            const action = notification.action;
            setNotification(null);
            if (action) action();
          }}
        />
      )}
    </div>
  );
}


export default App;
// Force update


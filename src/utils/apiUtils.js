import { getAbbrTimeZone } from './deviceUtils';
import { getToken } from './storageUtils';

const ALL_USERS_URL = (page, paginate) => `https://api.alkaysan.com/v2/account/user/get/all?paginate=${paginate}&page=${page}`;
const UPDATE_URL = (id) => `https://api.alkaysan.com/v2/account/user/update/${id}`;
const PROFILE_URL = "https://api.alkaysan.com/v2/account/user/get/me";
const ATTENDANCE_URL = "https://api.alkaysan.com/v2/account/attendance/add";

export const fetchUserProfile = async () => {
    const token = getToken();
    if (!token) {
        console.error('fetchUserProfile: No token found in any storage');
        throw new Error('NOT_LOGGED_IN');
    }

    // 10s Timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
        const response = await fetch(PROFILE_URL, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            console.error(`fetchUserProfile error: ${response.status} ${response.statusText}`);
            if (response.status === 401) throw new Error('SESI_BERAKHIR');
            const errorText = await response.text();
            console.error('fetchUserProfile error body:', errorText);
            throw new Error('Gagal mengambil profil user');
        }

        const result = await response.json();
        // console.log('fetchUserProfile success:', result); // Optional: debug success
        const profile = result.user || result;

        // Strict validation: Ensure profile has critical fields
        if (!profile || !profile.uniqueId) {
            console.error('Invalid profile data received:', profile);
            throw new Error('NOT_LOGGED_IN');
        }

        return profile;
    } catch (e) {
        console.error('fetchUserProfile exception:', e);
        throw e;
    }
};

export const searchEmployeeBatch = async (matchFn, paginate = 20) => {
    const token = getToken();
    if (!token) throw new Error('Token tidak ditemukan. Silakan login ulang.');

    let page = 1;
    let foundUser = null;

    while (true) {
        const response = await fetch(ALL_USERS_URL(page, paginate), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            if (response.status === 401) throw new Error('SESI_BERAKHIR');
            break;
        }

        const result = await response.json();
        const users = result.results?.data || [];

        if (users.length === 0) break;

        for (const user of users) {
            if (matchFn(user)) {
                foundUser = {
                    uniqueId: user.uniqueId,
                    nama_depan_karyawan: user.nama_depan_karyawan,
                    nama_belakang_karyawan: user.nama_belakang_karyawan,
                    email: user.email,
                    faceId: user.faceId,
                    pin_access: user.pin_access,
                    device_id: user.device_id,
                    last_sign_time: user.last_sign_time
                };
                break;
            }
        }

        if (foundUser) break;
        page++;
    }

    return foundUser;
};

export const updateUserSecurity = async (userId, updateData) => {
    const token = getToken();
    if (!token) throw new Error('NOT_LOGGED_IN');

    // Standardize field names for the backend
    // Note: faceId uses camelCase while others use snake_case based on API response patterns
    const payload = {
        device_id: updateData.device_id,
        pin_access: updateData.pin_access,
        faceId: updateData.faceId || updateData.face_id
    };

    console.log(`Attempting to update security for user ${userId}...`);

    try {
        const response = await fetch(UPDATE_URL(userId), {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            let errorMsg = `API Error ${response.status}: ${response.statusText}`;
            try {
                const errorData = await response.json();
                if (errorData.message) errorMsg = `${errorMsg} - ${errorData.message}`;
                if (errorData.errors) errorMsg = `${errorMsg} (${JSON.stringify(errorData.errors)})`;
            } catch (e) {
                const text = await response.text().catch(() => '');
                if (text) errorMsg = `${errorMsg} - ${text.substring(0, 100)}`;
            }
            console.error('updateUserSecurity failed:', errorMsg);
            throw new Error(errorMsg);
        }

        const result = await response.json();
        if (result.success === false) {
            console.error('updateUserSecurity result error:', result);
            throw new Error(result.message || 'Gagal memperbarui data keamanan');
        }

        console.log('updateUserSecurity successful:', result);
        return result;
    } catch (err) {
        console.error('updateUserSecurity exception:', err);
        throw err;
    }
};

export const saveOfflineAttendance = (attendanceData) => {
    const offlineData = JSON.parse(localStorage.getItem('offline_attendance') || '[]');
    offlineData.push({
        ...attendanceData,
        timestamp: new Date().toISOString()
    });
    localStorage.setItem('offline_attendance', JSON.stringify(offlineData));
};

export const submitAttendance = async ({ uniqueId, type, deviceName, location, time, sign_with }) => {
    const token = getToken();
    if (!token) throw new Error('NOT_LOGGED_IN');

    const formData = new FormData();
    formData.append('user', uniqueId);
    formData.append('type', type);
    formData.append('deviceName', deviceName);
    formData.append('AbbrTimeZone', getAbbrTimeZone());
    formData.append('location', location);
    formData.append('time', time);
    formData.append('sign_with', sign_with || 'unknown');

    const response = await fetch(ATTENDANCE_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            // Content-Type header is set automatically for FormData
        },
        body: formData,
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Gagal mengirim data absensi');
    }

    const result = await response.json();
    if (result.success === false) {
        throw new Error(result.message || 'Gagal mengirim data absensi');
    }

    return result;
};

export const verifyQrCode = async (secretKey) => {
    const token = getToken();
    if (!token) throw new Error('NOT_LOGGED_IN');

    const formData = new FormData();
    formData.append('key', secretKey);

    const response = await fetch("https://api.alkaysan.com/v2/account/attendance/verify-qr", {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'QR Code tidak valid atau tidak ditemukan di database.');
    }

    return await response.json();
};

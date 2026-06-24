/**
 * Format a Date object to YYYY-MM-DD HH:mm:ss
 */
export const formatDateTime = (date) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

/**
 * Set a cookie with the specified name, value, and expiration hours.
 */
export const setCookie = (name, value, hours) => {
    const expires = new Date();
    expires.setTime(expires.getTime() + (hours * 60 * 60 * 1000));
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
};

/**
 * Get a cookie value by name.
 */
export const getCookie = (name) => {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
};

/**
 * Initialize or retrieve the persistent sign-in time.
 * If cookie exists, returns it. If not, creates it and returns the new time.
 */
export const getOrInitSignTime = () => {
    let signTime = getCookie('signtime');
    if (!signTime) {
        signTime = formatDateTime(new Date());
        setCookie('signtime', signTime, 6);
        console.log('New signtime cookie created:', signTime);
    } else {
        console.log('Reusing existing signtime cookie:', signTime);
    }
    return signTime;
};

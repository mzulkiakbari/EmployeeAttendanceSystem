/**
 * Utility for managing authentication tokens with fallback to cookies
 * when localStorage is not available or persistent.
 */

const TOKEN_KEY = 'alkaysan_token';
const REFRESH_TOKEN_KEY = 'alkaysan_refresh_token';
const COOKIE_EXPIRY_YEARS = 1;

/**
 * Set a cookie with specified name, value, and expiry in years
 */
const setCookie = (name, value, years) => {
    const date = new Date();
    date.setTime(date.getTime() + (years * 365 * 24 * 60 * 60 * 1000));
    const expires = "; expires=" + date.toUTCString();
    // Use encodeURIComponent to safeguard special characters in tokens
    document.cookie = name + "=" + encodeURIComponent(value || "") + expires + "; path=/; SameSite=Lax";
};

/**
 * Get a cookie by name
 */
const getCookie = (name) => {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) {
            return decodeURIComponent(c.substring(nameEQ.length, c.length));
        }
    }
    return null;
};

/**
 * Delete a cookie by name
 */
const eraseCookie = (name) => {
    document.cookie = name + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax';
};

/**
 * Save token to localStorage and fallback to cookies
 */
export const setToken = (token) => {
    if (!token) return;

    // Try localStorage
    try {
        localStorage.setItem(TOKEN_KEY, token);
    } catch (e) {
        console.warn('localStorage is full or disabled, using cookies fallback');
    }

    // Always save to cookies as backup for 1 year
    setCookie(TOKEN_KEY, token, COOKIE_EXPIRY_YEARS);
};

/**
 * Save refresh token to localStorage and fallback to cookies
 */
export const setRefreshToken = (token) => {
    if (!token) return;

    // Try localStorage
    try {
        localStorage.setItem(REFRESH_TOKEN_KEY, token);
    } catch (e) {
        console.warn('localStorage is full or disabled, using cookies fallback');
    }

    // Always save to cookies as backup for 1 year
    setCookie(REFRESH_TOKEN_KEY, token, COOKIE_EXPIRY_YEARS);
};

/**
 * Get token from localStorage or cookies
 */
export const getToken = () => {
    let token = null;

    // Try localStorage first
    try {
        token = localStorage.getItem(TOKEN_KEY);
    } catch (e) {
        // localStorage not available
    }

    // If not in localStorage, try cookies
    if (!token) {
        token = getCookie(TOKEN_KEY);
        // If found in cookies, sync back to localStorage if possible
        if (token) {
            try {
                localStorage.setItem(TOKEN_KEY, token);
            } catch (e) {
                // Ignore sync error
            }
        }
    }

    return token;
};

/**
 * Get refresh token from localStorage or cookies
 */
export const getRefreshToken = () => {
    let token = null;

    try {
        token = localStorage.getItem(REFRESH_TOKEN_KEY);
    } catch (e) {
        // localStorage not available
    }

    if (!token) {
        token = getCookie(REFRESH_TOKEN_KEY);
    }

    return token;
};

/**
 * Clear all tokens from storage
 */
export const clearTokens = () => {
    try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch (e) {
        // localStorage not available
    }

    eraseCookie(TOKEN_KEY);
    eraseCookie(REFRESH_TOKEN_KEY);
};

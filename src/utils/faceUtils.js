/**
 * STABLE LANDMARKS SELECTION
 * Focus on rigid bone-structure points.
 */
export const STABLE_POINTS = [
    10, 151, 9, 8, 168, 6, 197, 195, 5, 4, 1, 2, // Midline
    33, 133, 157, 158, 159, 160, 161, 246, // Left Eye socket
    362, 263, 384, 385, 386, 387, 388, 466, // Right Eye socket
    103, 104, 108, 109, 332, 333, 337, 338, // Forehead
    21, 54, 162, 127, 234, 454, 389, 356, 284, 251 // Temple & Cheek bone
];

export const FACE_ID_THRESHOLD = 0.085;

export const alignPoints = (rawPoints) => {
    if (!rawPoints) return null;
    const points = STABLE_POINTS.map(i => rawPoints[i]);
    let cx = 0, cy = 0, cz = 0;
    points.forEach(p => { cx += p.x; cy += p.y; cz += (p.z || 0); });
    const centroid = { x: cx / points.length, y: cy / points.length, z: cz / points.length };

    let scale = 0;
    const centered = points.map(p => {
        const np = { x: p.x - centroid.x, y: p.y - centroid.y, z: ((p.z || 0) - centroid.z) * 0.5 }; // Dampen Z noise during alignment
        scale += Math.sqrt(np.x * np.x + np.y * np.y); // Scale based on 2D for stability
        return np;
    });
    scale /= points.length;

    return centered.map(p => ({ x: p.x / scale, y: p.y / scale, z: p.z / scale }));
};

export const compareFaceLandmarks = (capturedLandmarks, registeredLandmarks) => {
    if (!capturedLandmarks || !registeredLandmarks || capturedLandmarks.length < 468) {
        return { isMatch: false, score: 1.0 };
    }

    const capAligned = alignPoints(capturedLandmarks);
    const regAligned = alignPoints(registeredLandmarks);

    let totalDistance = 0;
    for (let i = 0; i < capAligned.length; i++) {
        const dx = capAligned[i].x - regAligned[i].x;
        const dy = capAligned[i].y - regAligned[i].y;
        const dz = (capAligned[i].z - regAligned[i].z) * 0.4; // Significantly dampen Z noise in distance

        totalDistance += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    const score = totalDistance / capAligned.length;
    return { isMatch: score < FACE_ID_THRESHOLD, score };
};

export const analyzeFaceQuality = (landmarks) => {
    if (!landmarks || landmarks.length < 468) return { status: 'NO_FACE', message: 'Mencari Wajah...' };

    // 1. Centering Check (0.5 is center)
    let avgX = 0, avgY = 0;
    landmarks.forEach(p => { avgX += p.x; avgY += p.y; });
    avgX /= landmarks.length;
    avgY /= landmarks.length;

    const offCenterThreshold = 0.15;
    if (Math.abs(avgX - 0.5) > offCenterThreshold || Math.abs(avgY - 0.5) > offCenterThreshold) {
        return { status: 'OFF_CENTER', message: 'Posisikan Wajah ke Tengah' };
    }

    // 2. Distance/Scale Check
    // Use eye-to-eye distance as a proxy for face size
    const leftEye = landmarks[33];
    const rightEye = landmarks[263];
    const eyeDist = Math.sqrt(Math.pow(rightEye.x - leftEye.x, 2) + Math.pow(rightEye.y - leftEye.y, 2));

    if (eyeDist < 0.18) return { status: 'TOO_FAR', message: 'Dekatkan Wajah ke Kamera' };
    if (eyeDist > 0.45) return { status: 'TOO_CLOSE', message: 'Jauhkan sedikit Wajah' };

    // 3. Pose/Rotation Check (Rough estimate)
    const noseTip = landmarks[1];
    const leftCheek = landmarks[234];
    const rightCheek = landmarks[454];
    const cheekDistLeft = Math.abs(noseTip.x - leftCheek.x);
    const cheekDistRight = Math.abs(noseTip.x - rightCheek.x);
    const symmetryRatio = Math.max(cheekDistLeft, cheekDistRight) / Math.min(cheekDistLeft, cheekDistRight);

    if (symmetryRatio > 2.0) return { status: 'NOT_FRONTAL', message: 'Hadapkan Wajah Lurus ke Kamera' };

    return { status: 'OK', message: 'Posisi Bagus!' };
};

export const calculateSimilarity = (score) => {
    if (score === null || score === undefined) return 0;
    // Map raw distance (0.0 to 0.425) to percentage (100% to 0%)
    // This makes 0.085 (threshold) = 80% similarity
    const maxDistance = 0.425;
    const percentage = (1 - (score / maxDistance)) * 100;
    return Math.max(0, Math.min(100, percentage));
};

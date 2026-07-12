const YOUTUBE_URL_PATTERNS = [
    /(?:^|[?&])v=([A-Za-z0-9_-]{4,})/i,
    /(?:^|\/)shorts\/([A-Za-z0-9_-]{4,})/i,
    /(?:^|\/)embed\/([A-Za-z0-9_-]{4,})/i,
    /(?:^|\/)live\/([A-Za-z0-9_-]{4,})/i,
    /youtu\.be\/([A-Za-z0-9_-]{4,})/i,
];
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function extractYouTubeVideoId(rawUrl) {
    const trimmed = rawUrl.trim();
    if (!trimmed)
        return null;
    const candidate = trimmed.replace(/^\/+/, '');
    for (const pattern of YOUTUBE_URL_PATTERNS) {
        const match = candidate.match(pattern) ?? trimmed.match(pattern);
        if (match?.[1]) {
            return match[1];
        }
    }
    const firstSegment = candidate.split(/[?&#/]/)[0];
    if (/^[A-Za-z0-9_-]{4,}$/.test(firstSegment)) {
        return firstSegment;
    }
    return null;
}
export function normalizeMarketingUrlType(value) {
    const trimmed = normalizeText(value);
    if (!trimmed)
        return '';
    const normalized = trimmed.toLowerCase();
    if (normalized === '1' || normalized === 'youtube')
        return 'YouTube';
    if (normalized === '2' || normalized === 'matterport')
        return 'MatterPort';
    if (normalized === '3' || normalized === 'eyespy360')
        return 'EyeSpy360';
    if (normalized === '4' || normalized === 'virtual tours')
        return 'Virtual Tours';
    return trimmed;
}
export function normalizeMarketingUrl(value, urlType) {
    const trimmed = normalizeText(value);
    if (!trimmed)
        return '';
    if (normalizeMarketingUrlType(urlType) !== 'YouTube') {
        return trimmed;
    }
    const videoId = extractYouTubeVideoId(trimmed);
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : trimmed;
}
export function normalizeMarketingUrlRecord(row) {
    const url_type = normalizeMarketingUrlType(row.url_type);
    return {
        ...row,
        url_type,
        url: normalizeMarketingUrl(row.url, url_type),
    };
}
//# sourceMappingURL=marketingUrls.js.map
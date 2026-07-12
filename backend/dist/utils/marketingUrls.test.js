import { describe, expect, it } from 'vitest';
import { normalizeMarketingUrl, normalizeMarketingUrlRecord, normalizeMarketingUrlType } from './marketingUrls.js';
describe('marketingUrls', () => {
    it('normalizes legacy url types to canonical labels', () => {
        expect(normalizeMarketingUrlType('1')).toBe('YouTube');
        expect(normalizeMarketingUrlType('youtube')).toBe('YouTube');
        expect(normalizeMarketingUrlType('2')).toBe('MatterPort');
        expect(normalizeMarketingUrlType('3')).toBe('EyeSpy360');
        expect(normalizeMarketingUrlType('4')).toBe('Virtual Tours');
    });
    it('normalizes YouTube URLs to a full watch URL when the type is YouTube', () => {
        expect(normalizeMarketingUrl('v=kR0Sh9mq5IY', '1')).toBe('https://www.youtube.com/watch?v=kR0Sh9mq5IY');
        expect(normalizeMarketingUrl('nUzxr-qqWew', 'YouTube')).toBe('https://www.youtube.com/watch?v=nUzxr-qqWew');
        expect(normalizeMarketingUrl('https://youtu.be/nUzxr-qqWew', 'YouTube')).toBe('https://www.youtube.com/watch?v=nUzxr-qqWew');
    });
    it('leaves non-YouTube URLs unchanged', () => {
        expect(normalizeMarketingUrl('https://my.matterport.com/show/?m=abc123', 'MatterPort')).toBe('https://my.matterport.com/show/?m=abc123');
    });
    it('normalizes an entire row record', () => {
        expect(normalizeMarketingUrlRecord({ url: 'v=abc123XYZ99', url_type: '1', display_name: null })).toEqual({
            url: 'https://www.youtube.com/watch?v=abc123XYZ99',
            url_type: 'YouTube',
            display_name: null,
        });
    });
});
//# sourceMappingURL=marketingUrls.test.js.map
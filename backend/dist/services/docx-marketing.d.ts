import type { MarketingPlanData, MarketingPlanFormData } from './openai-marketing.js';
export declare function buildMarketingPlanDocument({ marketingPlanData, formData, logoBuffer, }: {
    marketingPlanData: MarketingPlanData;
    formData: MarketingPlanFormData;
    logoBuffer: Buffer | null;
}): Promise<Buffer>;
//# sourceMappingURL=docx-marketing.d.ts.map
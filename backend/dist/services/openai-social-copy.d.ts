export type SocialCopyPlatform = 'instagram' | 'facebook';
export interface ListingSocialCopyPromptData {
    platform: SocialCopyPlatform;
    statusPill: string;
    tone: string;
    includeEmojis: boolean;
    includeHashtags: boolean;
    listingTitle: string;
    propertyType: string | null;
    saleOrRent: string | null;
    price: string | null;
    bedrooms: string | null;
    bathrooms: string | null;
    parking: string | null;
    suburb: string | null;
    cityProvince: string | null;
    description: string | null;
    keyFeatures: string[];
    mandateOrStatus: string | null;
    listingNumber: string;
    agentListingLink: string;
    agentFirstName: string;
    agentFullName: string;
    agentPhone: string;
    agentEmail: string;
    marketCentreName: string | null;
}
export interface SocialCopyValidationResult {
    valid: boolean;
    sanitizedText: string;
    reasons: string[];
}
export declare function generateListingSocialCopy(input: ListingSocialCopyPromptData): Promise<string>;
export declare function validateGeneratedSocialCopy(text: string, input: ListingSocialCopyPromptData): SocialCopyValidationResult;
export declare function sanitizeSocialCopyText(text: string, listingPrice?: string | null): string;
//# sourceMappingURL=openai-social-copy.d.ts.map
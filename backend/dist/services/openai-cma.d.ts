export interface CmaFormData {
    propertyAddress: string;
    propertyType: string;
    bedrooms: string;
    bathrooms: string;
    parking: string;
    specialFeatures: string;
    sellerName: string;
    sellerSurname: string;
    sellerEmail: string;
    sellerPhone: string;
    agentName: string;
    agentTitle: string;
    marketCentre: string;
    agentPhone: string;
    agentEmail: string;
}
export interface CmaData {
    coverPage: {
        propertyAddress: string;
        agentDetails: string;
    };
    marketOverview: {
        areaTrends: string[];
        buyerActivity: string[];
        priceMovement: string[];
    };
    subjectPropertyOverview: {
        summary: string;
        highlights: string[];
    };
    recentComparableSales: Array<{
        address: string;
        beds: string;
        baths: string;
        parking: string;
        soldPrice: string;
        soldDate: string;
    }>;
    currentMarketListings: Array<{
        title: string;
        propertyType: string;
        beds: string;
        baths: string;
        price: string;
        url: string;
    }>;
    pricingStrategy: {
        lowPrice: string;
        recommendedPrice: string;
        highPrice: string;
        commentary: string[];
    };
    positiveMarketFactors: string[];
    negativeMarketFactors: string[];
    conclusion: {
        exactRecommendedPrice: string;
        justification: string;
    };
    sources?: Array<{
        title: string;
        url: string;
    }>;
}
export declare function generateCmaData({ formData, loomReportBuffer, loomReportOriginalName, }: {
    formData: CmaFormData;
    loomReportBuffer: Buffer;
    loomReportOriginalName: string;
}): Promise<CmaData>;
//# sourceMappingURL=openai-cma.d.ts.map
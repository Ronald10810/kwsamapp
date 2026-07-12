export interface MarketingPlanFormData {
    agentName: string;
    agencyBrand: string;
    agentPhone: string;
    agentEmail: string;
    propertyAddress: string;
    suburbArea: string;
    sellerName: string;
    sellerSurname: string;
    sellerEmail: string;
    sellerPhone: string;
    customPromptInput: string;
}
export interface MarketingPlanData {
    coverPage: {
        documentTitle: string;
        propertyAddress: string;
        suburbArea: string;
        preparedBy: string;
        agencyBrand: string;
        preparedFor: string;
        datePrepared: string;
    };
    propertySnapshot: {
        summary: string[];
        keyFacts: Array<{
            field: string;
            value: string;
        }>;
    };
    pricingAndPositioningSummary: {
        summaryParagraphs: string[];
        pricingTable: Array<{
            metric: string;
            value: string;
            note: string;
        }>;
    };
    uniqueSellingPointsAndTargetBuyerProfiles: {
        uniqueSellingPoints: string[];
        targetBuyerProfiles: Array<{
            profileName: string;
            profileSummary: string;
            matchingFeatures: string[];
        }>;
        messagingAngles: string[];
    };
    fourWeekMarketingStrategyOverview: {
        strategySummary: string[];
        weeklyPlan: Array<{
            week: string;
            objective: string;
            channels: string;
            actions: string;
            expectedOutcome: string;
        }>;
    };
    onlineListingCopy: {
        property24Title: string;
        property24FullDescription: string[];
        shortTitle: string;
        shortDescription: string;
        optionalHookLines: string[];
    };
    socialMediaAndPaidAdsPlan: {
        platformGuidance: string[];
        posts: Array<{
            week: string;
            platform: string;
            theme: string;
            visualIdea: string;
            caption: string;
            cta: string;
            hashtags: string;
        }>;
        paidAds: Array<{
            conceptName: string;
            creativeDirection: string;
            adCopy: string;
            targeting: string;
        }>;
    };
    buyerDatabaseAndFollowUpCampaign: {
        targetingApproach: string[];
        timeline: Array<{
            dayOrWeek: string;
            channel: string;
            objective: string;
            fullScriptOrMessage: string;
        }>;
        complianceNotes: string[];
    };
    mediaAndAssetChecklist: Array<{
        item: string;
        owner: string;
        dueDate: string;
        status: string;
        notes: string;
    }>;
    reportingAndFeedbackSchedule: Array<{
        timing: string;
        activity: string;
        output: string;
        owner: string;
    }>;
    nextStepsAndApprovals: {
        nextSteps: string[];
        approvalsRequired: string[];
        sellerApprovalBlock: string[];
    };
}
export declare function generateMarketingPlanData({ formData, cmaBuffer, cmaOriginalName, loomReportBuffer, loomReportOriginalName, }: {
    formData: MarketingPlanFormData;
    cmaBuffer: Buffer;
    cmaOriginalName: string;
    loomReportBuffer: Buffer;
    loomReportOriginalName: string;
}): Promise<MarketingPlanData>;
//# sourceMappingURL=openai-marketing.d.ts.map
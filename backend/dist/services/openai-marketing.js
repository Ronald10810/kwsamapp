import { createRequire } from 'node:module';
import OpenAI from 'openai';
import { env } from '../config/env.js';
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfParseModule = require('pdf-parse');
const pdfParseFn = typeof pdfParseModule === 'function'
    ? pdfParseModule
    : typeof pdfParseModule?.default === 'function'
        ? pdfParseModule.default
        : null;
const PdfParseClass = typeof pdfParseModule?.PDFParse === 'function'
    ? pdfParseModule.PDFParse
    : null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mammoth = require('mammoth');
export async function generateMarketingPlanData({ formData, cmaBuffer, cmaOriginalName, loomReportBuffer, loomReportOriginalName, }) {
    if (!env.openai.apiKey) {
        throw new Error('OPENAI_API_KEY is not configured on this server.');
    }
    const client = new OpenAI({ apiKey: env.openai.apiKey, timeout: 8 * 60 * 1000, maxRetries: 0 });
    const [cmaText, loomText] = await Promise.all([
        extractDocumentText(cmaBuffer, cmaOriginalName),
        extractDocumentText(loomReportBuffer, loomReportOriginalName),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await client.responses.create({
        model: env.openai.model,
        text: {
            format: {
                type: 'json_schema',
                name: 'kw_marketing_plan',
                strict: true,
                schema: marketingPlanSchema,
            },
        },
        input: [
            {
                role: 'system',
                content: [{ type: 'input_text', text: buildSystemPrompt() }],
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'input_text',
                        text: buildUserPrompt(formData, cmaOriginalName, cmaText, loomReportOriginalName, loomText),
                    },
                ],
            },
        ],
    });
    const outputText = response.output_text?.trim();
    if (!outputText) {
        throw new Error('The model returned an empty response.');
    }
    return JSON.parse(outputText);
}
function buildSystemPrompt() {
    return `You are an expert real estate marketing team creating a professional seller-facing marketing plan.

Follow these rules exactly:
- Do not hallucinate property details. Use only CMA input, Loom input, and provided variables.
- If important data is missing, write placeholders like [CONFIRM: ...].
- Maintain a consistent document structure and heading order for every response.
- Use South African real estate English and ZAR pricing style.
- Use clear, practical, seller-friendly language with tactical actions and timelines.
- Do not use emojis.
- Do not use long dashes. Use normal hyphens.
- Ensure output is reusable and operational, not generic marketing fluff.
- Keep persona outputs distinct and non-overlapping.

You must process these personas in order internally:
1) Marketing Specialist
2) Copywriter
3) Social Media Specialist
4) Email Marketing Specialist

Then assemble a final structured output in this exact section sequence:
1. Cover Page
2. Property Snapshot
3. Pricing and Positioning Summary
4. Unique Selling Points and Target Buyer Profiles
5. 4-Week Marketing Strategy Overview
6. Online Listing Copy
7. Social Media and Paid Ads Plan
8. Buyer Database and Follow-Up Campaign
9. Media and Asset Checklist
10. Reporting and Feedback Schedule
11. Next Steps and Approvals

Return JSON only.`;
}
function buildUserPrompt(formData, cmaOriginalName, cmaText, loomReportOriginalName, loomReportText) {
    return `Create a seller-ready property marketing plan that is consistent and structured.

Seller/Agent Variables:
- Agent Name: ${orConfirm(formData.agentName, 'Agent Name')}
- Agency / Brand: ${orConfirm(formData.agencyBrand, 'Agency / Brand')}
- Agent Phone: ${orConfirm(formData.agentPhone, 'Agent Phone')}
- Agent Email: ${orConfirm(formData.agentEmail, 'Agent Email')}
- Property Address: ${orConfirm(formData.propertyAddress, 'Property Address')}
- Suburb / Area: ${orConfirm(formData.suburbArea, 'Suburb / Area')}
- Seller First Name: ${orConfirm(formData.sellerName, 'Seller First Name')}
- Seller Surname: ${orConfirm(formData.sellerSurname, 'Seller Surname')}
- Seller Email: ${orConfirm(formData.sellerEmail, 'Seller Email')}
- Seller Phone: ${orConfirm(formData.sellerPhone, 'Seller Phone')}

Additional user notes:
${orConfirm(formData.customPromptInput, 'Additional user prompt input')}

CMA source file:
- ${cmaOriginalName}

CMA extracted text:
${cmaText}

Loom source file:
- ${loomReportOriginalName}

Loom extracted text:
${loomReportText}`;
}
function orConfirm(value, label) {
    const v = value?.trim();
    return v ? v : `[CONFIRM: ${label}]`;
}
async function extractDocumentText(buffer, originalName) {
    const lower = originalName.toLowerCase();
    if (lower.endsWith('.pdf')) {
        return extractPdfText(buffer);
    }
    if (lower.endsWith('.docx')) {
        return extractDocxText(buffer);
    }
    throw new Error(`Unsupported file type for ${originalName}. Please upload PDF or DOCX.`);
}
async function extractPdfText(buffer) {
    let text = '';
    if (pdfParseFn) {
        const result = await pdfParseFn(buffer);
        text = result.text ?? '';
    }
    else if (PdfParseClass) {
        const parser = new PdfParseClass({ data: new Uint8Array(buffer) });
        try {
            const result = await parser.getText();
            text = typeof result === 'string' ? result : (result.text ?? '');
        }
        finally {
            await parser.destroy?.();
        }
    }
    else {
        throw new Error('pdf-parse could not be initialized on this server.');
    }
    const cleaned = text.replace(/\s+\n/g, '\n').trim();
    if (!cleaned) {
        throw new Error('The uploaded PDF could not be read. Please upload a clearer document.');
    }
    return cleaned.slice(0, 70000);
}
async function extractDocxText(buffer) {
    const result = await mammoth.extractRawText({ buffer });
    const cleaned = (result.value ?? '').replace(/\s+\n/g, '\n').trim();
    if (!cleaned) {
        throw new Error('The uploaded DOCX could not be read. Please upload a valid Word document.');
    }
    return cleaned.slice(0, 70000);
}
const marketingPlanSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'coverPage',
        'propertySnapshot',
        'pricingAndPositioningSummary',
        'uniqueSellingPointsAndTargetBuyerProfiles',
        'fourWeekMarketingStrategyOverview',
        'onlineListingCopy',
        'socialMediaAndPaidAdsPlan',
        'buyerDatabaseAndFollowUpCampaign',
        'mediaAndAssetChecklist',
        'reportingAndFeedbackSchedule',
        'nextStepsAndApprovals',
    ],
    properties: {
        coverPage: {
            type: 'object',
            additionalProperties: false,
            required: ['documentTitle', 'propertyAddress', 'suburbArea', 'preparedBy', 'agencyBrand', 'preparedFor', 'datePrepared'],
            properties: {
                documentTitle: { type: 'string' },
                propertyAddress: { type: 'string' },
                suburbArea: { type: 'string' },
                preparedBy: { type: 'string' },
                agencyBrand: { type: 'string' },
                preparedFor: { type: 'string' },
                datePrepared: { type: 'string' },
            },
        },
        propertySnapshot: {
            type: 'object',
            additionalProperties: false,
            required: ['summary', 'keyFacts'],
            properties: {
                summary: { type: 'array', items: { type: 'string' } },
                keyFacts: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['field', 'value'],
                        properties: {
                            field: { type: 'string' },
                            value: { type: 'string' },
                        },
                    },
                },
            },
        },
        pricingAndPositioningSummary: {
            type: 'object',
            additionalProperties: false,
            required: ['summaryParagraphs', 'pricingTable'],
            properties: {
                summaryParagraphs: { type: 'array', items: { type: 'string' } },
                pricingTable: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['metric', 'value', 'note'],
                        properties: {
                            metric: { type: 'string' },
                            value: { type: 'string' },
                            note: { type: 'string' },
                        },
                    },
                },
            },
        },
        uniqueSellingPointsAndTargetBuyerProfiles: {
            type: 'object',
            additionalProperties: false,
            required: ['uniqueSellingPoints', 'targetBuyerProfiles', 'messagingAngles'],
            properties: {
                uniqueSellingPoints: { type: 'array', items: { type: 'string' } },
                targetBuyerProfiles: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['profileName', 'profileSummary', 'matchingFeatures'],
                        properties: {
                            profileName: { type: 'string' },
                            profileSummary: { type: 'string' },
                            matchingFeatures: { type: 'array', items: { type: 'string' } },
                        },
                    },
                },
                messagingAngles: { type: 'array', items: { type: 'string' } },
            },
        },
        fourWeekMarketingStrategyOverview: {
            type: 'object',
            additionalProperties: false,
            required: ['strategySummary', 'weeklyPlan'],
            properties: {
                strategySummary: { type: 'array', items: { type: 'string' } },
                weeklyPlan: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['week', 'objective', 'channels', 'actions', 'expectedOutcome'],
                        properties: {
                            week: { type: 'string' },
                            objective: { type: 'string' },
                            channels: { type: 'string' },
                            actions: { type: 'string' },
                            expectedOutcome: { type: 'string' },
                        },
                    },
                },
            },
        },
        onlineListingCopy: {
            type: 'object',
            additionalProperties: false,
            required: ['property24Title', 'property24FullDescription', 'shortTitle', 'shortDescription', 'optionalHookLines'],
            properties: {
                property24Title: { type: 'string' },
                property24FullDescription: { type: 'array', items: { type: 'string' } },
                shortTitle: { type: 'string' },
                shortDescription: { type: 'string' },
                optionalHookLines: { type: 'array', items: { type: 'string' } },
            },
        },
        socialMediaAndPaidAdsPlan: {
            type: 'object',
            additionalProperties: false,
            required: ['platformGuidance', 'posts', 'paidAds'],
            properties: {
                platformGuidance: { type: 'array', items: { type: 'string' } },
                posts: {
                    type: 'array',
                    minItems: 12,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['week', 'platform', 'theme', 'visualIdea', 'caption', 'cta', 'hashtags'],
                        properties: {
                            week: { type: 'string' },
                            platform: { type: 'string' },
                            theme: { type: 'string' },
                            visualIdea: { type: 'string' },
                            caption: { type: 'string' },
                            cta: { type: 'string' },
                            hashtags: { type: 'string' },
                        },
                    },
                },
                paidAds: {
                    type: 'array',
                    minItems: 3,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['conceptName', 'creativeDirection', 'adCopy', 'targeting'],
                        properties: {
                            conceptName: { type: 'string' },
                            creativeDirection: { type: 'string' },
                            adCopy: { type: 'string' },
                            targeting: { type: 'string' },
                        },
                    },
                },
            },
        },
        buyerDatabaseAndFollowUpCampaign: {
            type: 'object',
            additionalProperties: false,
            required: ['targetingApproach', 'timeline', 'complianceNotes'],
            properties: {
                targetingApproach: { type: 'array', items: { type: 'string' } },
                timeline: {
                    type: 'array',
                    minItems: 14,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['dayOrWeek', 'channel', 'objective', 'fullScriptOrMessage'],
                        properties: {
                            dayOrWeek: { type: 'string' },
                            channel: { type: 'string' },
                            objective: { type: 'string' },
                            fullScriptOrMessage: { type: 'string' },
                        },
                    },
                },
                complianceNotes: { type: 'array', items: { type: 'string' } },
            },
        },
        mediaAndAssetChecklist: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['item', 'owner', 'dueDate', 'status', 'notes'],
                properties: {
                    item: { type: 'string' },
                    owner: { type: 'string' },
                    dueDate: { type: 'string' },
                    status: { type: 'string' },
                    notes: { type: 'string' },
                },
            },
        },
        reportingAndFeedbackSchedule: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['timing', 'activity', 'output', 'owner'],
                properties: {
                    timing: { type: 'string' },
                    activity: { type: 'string' },
                    output: { type: 'string' },
                    owner: { type: 'string' },
                },
            },
        },
        nextStepsAndApprovals: {
            type: 'object',
            additionalProperties: false,
            required: ['nextSteps', 'approvalsRequired', 'sellerApprovalBlock'],
            properties: {
                nextSteps: { type: 'array', items: { type: 'string' } },
                approvalsRequired: { type: 'array', items: { type: 'string' } },
                sellerApprovalBlock: { type: 'array', items: { type: 'string' } },
            },
        },
    },
};
//# sourceMappingURL=openai-marketing.js.map
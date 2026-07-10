import { createRequire } from 'node:module';
import OpenAI from 'openai';
import { env } from '../config/env.js';

const require = createRequire(import.meta.url);
type PdfParseResult = { text: string };
type PdfParseFn = (buf: Buffer) => Promise<PdfParseResult>;
type PdfParseClassCtor = new (options: { data: Uint8Array; verbosity?: number }) => {
  getText: () => Promise<PdfParseResult | string>;
  destroy?: () => Promise<void> | void;
};

// pdf-parse export shape differs across versions/runtimes.
// Support legacy function exports and modern class-based exports.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfParseModule = require('pdf-parse') as any;
const pdfParseFn: PdfParseFn | null =
  typeof pdfParseModule === 'function'
    ? (pdfParseModule as PdfParseFn)
    : typeof pdfParseModule?.default === 'function'
      ? (pdfParseModule.default as PdfParseFn)
      : null;
const PdfParseClass: PdfParseClassCtor | null =
  typeof pdfParseModule?.PDFParse === 'function'
    ? (pdfParseModule.PDFParse as PdfParseClassCtor)
    : null;

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
  coverPage: { propertyAddress: string; agentDetails: string };
  marketOverview: { areaTrends: string[]; buyerActivity: string[]; priceMovement: string[] };
  subjectPropertyOverview: { summary: string; highlights: string[] };
  recentComparableSales: Array<{ address: string; beds: string; baths: string; parking: string; soldPrice: string; soldDate: string }>;
  currentMarketListings: Array<{ title: string; propertyType: string; beds: string; baths: string; price: string; url: string }>;
  pricingStrategy: { lowPrice: string; recommendedPrice: string; highPrice: string; commentary: string[] };
  positiveMarketFactors: string[];
  negativeMarketFactors: string[];
  conclusion: { exactRecommendedPrice: string; justification: string };
  sources?: Array<{ title: string; url: string }>;
}

export async function generateCmaData({
  formData,
  loomReportBuffer,
  loomReportOriginalName,
}: {
  formData: CmaFormData;
  loomReportBuffer: Buffer;
  loomReportOriginalName: string;
}): Promise<CmaData> {
  if (!env.openai.apiKey) {
    throw new Error('OPENAI_API_KEY is not configured on this server.');
  }

  const client = new OpenAI({ apiKey: env.openai.apiKey });
  const loomReportText = await extractPdfText(loomReportBuffer);
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(formData, loomReportOriginalName, loomReportText);

  let response = await requestCmaResponse(client, systemPrompt, userPrompt);
  let parsed = parseCmaResponse(response);

  // Retry once with stricter search guidance if portal coverage is weak.
  if (needsPortalCoverageRetry(parsed.currentMarketListings)) {
    const retryDirective = [
      userPrompt,
      '',
      'RETRY DIRECTIVE (MANDATORY):',
      '- Re-run live web search from scratch for active comparable listings near the subject property.',
      '- Use explicit portal-targeted search patterns such as: site:property24.com and site:privateproperty.co.za with suburb, bedrooms, bathrooms, and property type.',
      '- Prioritise close location and feature match over broad area matches.',
      '- Return valid, clickable listing URLs and avoid generic landing pages.',
      '- Ensure the listing table is evidence-rich and professional.',
    ].join('\n');

    response = await requestCmaResponse(client, systemPrompt, retryDirective);
    parsed = parseCmaResponse(response);
  }

  parsed.sources = extractSources(response);
  return parsed;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requestCmaResponse(client: OpenAI, systemPrompt: string, userPrompt: string): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (client as any).responses.create({
    model: env.openai.model,
    tools: [
      {
        type: 'web_search',
        user_location: {
          type: 'approximate',
          country: 'ZA',
          timezone: 'Africa/Johannesburg',
        },
      },
    ],
    include: ['web_search_call.action.sources'],
    text: {
      format: {
        type: 'json_schema',
        name: 'kw_market_centre_cma',
        strict: true,
        schema: cmaSchema,
      },
    },
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: systemPrompt }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: userPrompt }],
      },
    ],
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCmaResponse(response: any): CmaData {
  const outputText = (response.output_text as string | undefined)?.trim();
  if (!outputText) {
    throw new Error('The model returned an empty response.');
  }

  return JSON.parse(outputText) as CmaData;
}

function needsPortalCoverageRetry(listings: CmaData['currentMarketListings']): boolean {
  const normalizedUrls = listings
    .map((listing) => (listing.url || '').trim().toLowerCase())
    .filter(Boolean);

  const property24Count = normalizedUrls.filter((url) => /(^|\.)property24\./.test(url)).length;
  const privatePropertyCount = normalizedUrls.filter((url) => /privateproperty\./.test(url)).length;
  const portalCount = property24Count + privatePropertyCount;

  return portalCount < 4 || property24Count === 0 || privatePropertyCount === 0;
}

function buildSystemPrompt(): string {
  return `You are acting as a professional Keller Williams real estate agent creating a Comparative Market Analysis (CMA) for a seller presentation.

Follow these rules exactly:
- Use Keller Williams branding language throughout and reference the supplied Market Centre name exactly; never hardcode a different market centre name.
- Produce seller-friendly but formal language.
- Focus on the South African market and currency formatting in ZAR using the R symbol.
- Keep the document structure fixed and complete.
- Base the subject property overview, property characteristics, area insights, and comparable context on the uploaded Loom property report.
- Search the live web for current active listings in the same area with similar features, prioritising Property24 and Private Property.
- Use portal-targeted search behavior: run queries specifically aimed at Property24 and Private Property domain results.
- Prefer listings with strong locality match (same suburb first, then nearby suburbs only when needed).
- Use the live web sources as core pricing evidence, not as optional context.
- Derive the pricing strategy from the combined weight of the Loom report, recent comparable sales, and all useful active listing links found during web search.
- Prefer the strongest, most relevant comparable evidence and ignore weak or obviously mismatched listings.
- Include at least 5 active listings.
- Ensure both Property24 and Private Property are represented where results are available.
- Include clickable listing URLs when available.
- Include recent comparable sales where reasonably available.
- Keep the listing URLs in the structured output so the system can retain them for internal reference, but do not add a standalone source-links section or bibliography to the CMA narrative.
- Never use emojis.
- If data is missing, state the limitation clearly rather than inventing facts.
- Always provide one exact recommended price in the conclusion.

Return JSON only.`;
}

function buildUserPrompt(formData: CmaFormData, loomReportOriginalName: string, loomReportText: string): string {
  return `Create a CMA using this exact document structure:
1. Cover Page
2. Market Overview
3. Subject Property Overview (Lightstone-based if supported by report content)
4. Recent Comparable Sales
5. Current Market Listings
6. Pricing Strategy
7. Positive Market Factors
8. Negative Market Factors
9. Conclusion

Strict branding and footer details:
- Keller Williams (use the supplied Market Centre for all office-specific references)
- Agent Name: ${formData.agentName}
- Title: ${formData.agentTitle}
- Market Centre: ${formData.marketCentre}
- Phone: ${formData.agentPhone}
- Email: ${formData.agentEmail}

Subject property details:
- Address: ${formData.propertyAddress}
- Property Type: ${formData.propertyType}
- Bedrooms: ${formData.bedrooms}
- Bathrooms: ${formData.bathrooms}
- Garages / Parking: ${formData.parking}
- Special Features: ${formData.specialFeatures}

Seller details:
- Name: ${formData.sellerName}
- Surname: ${formData.sellerSurname}
- Email: ${formData.sellerEmail}
- Phone: ${formData.sellerPhone}

Report instructions:
- The uploaded file is the Loom property report.
- Analyse it for property characteristics, area trends, and comparable context.
- Search for active listings in the same area with similar features.
- Use the live active listings and comparable sales directly when deciding the low, recommended, and high price points.
- Make the pricing strategy evidence-led and conservative where data conflicts, but do not ignore relevant live listing evidence.
- Keep all useful listing URLs in the JSON for internal reference.
- Make the output consistent, polished, and presentation-ready.
- Use South African English.
- For pricing strategy, provide low price, recommended price, and high price.
- The conclusion must state one exact recommended price and a short confident justification.

Loom property report file name:
- ${loomReportOriginalName}

Extracted Loom property report text:
${loomReportText}`;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  let text = '';

  if (pdfParseFn) {
    const result = await pdfParseFn(buffer);
    text = result.text ?? '';
  } else if (PdfParseClass) {
    const parser = new PdfParseClass({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      text = typeof result === 'string' ? result : (result.text ?? '');
    } finally {
      await parser.destroy?.();
    }
  } else {
    throw new Error('pdf-parse could not be initialized on this server.');
  }

  const cleanedText = text.replace(/\s+\n/g, '\n').trim();

  if (!cleanedText) {
    throw new Error(
      'The uploaded PDF could not be read. Please try a clearer PDF export of the Loom report.'
    );
  }

  return cleanedText.slice(0, 50000);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractSources(response: any): Array<{ title: string; url: string }> {
  const sources: Array<{ title: string; url: string }> = [];

  for (const item of response.output || []) {
    if (item.type !== 'web_search_call') continue;

    const foundSources = item.action?.sources || [];
    for (const source of foundSources) {
      if (!source.url) continue;
      const alreadyIncluded = sources.some((existing) => existing.url === source.url);
      if (!alreadyIncluded) {
        sources.push({ title: source.title || source.url, url: source.url });
      }
    }
  }

  return sources;
}

const cmaSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'coverPage',
    'marketOverview',
    'subjectPropertyOverview',
    'recentComparableSales',
    'currentMarketListings',
    'pricingStrategy',
    'positiveMarketFactors',
    'negativeMarketFactors',
    'conclusion',
  ],
  properties: {
    coverPage: {
      type: 'object',
      additionalProperties: false,
      required: ['propertyAddress', 'agentDetails'],
      properties: {
        propertyAddress: { type: 'string' },
        agentDetails: { type: 'string' },
      },
    },
    marketOverview: {
      type: 'object',
      additionalProperties: false,
      required: ['areaTrends', 'buyerActivity', 'priceMovement'],
      properties: {
        areaTrends: { type: 'array', items: { type: 'string' } },
        buyerActivity: { type: 'array', items: { type: 'string' } },
        priceMovement: { type: 'array', items: { type: 'string' } },
      },
    },
    subjectPropertyOverview: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'highlights'],
      properties: {
        summary: { type: 'string' },
        highlights: { type: 'array', items: { type: 'string' } },
      },
    },
    recentComparableSales: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['address', 'beds', 'baths', 'parking', 'soldPrice', 'soldDate'],
        properties: {
          address: { type: 'string' },
          beds: { type: 'string' },
          baths: { type: 'string' },
          parking: { type: 'string' },
          soldPrice: { type: 'string' },
          soldDate: { type: 'string' },
        },
      },
    },
    currentMarketListings: {
      type: 'array',
      minItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'propertyType', 'beds', 'baths', 'price', 'url'],
        properties: {
          title: { type: 'string' },
          propertyType: { type: 'string' },
          beds: { type: 'string' },
          baths: { type: 'string' },
          price: { type: 'string' },
          url: { type: 'string' },
        },
      },
    },
    pricingStrategy: {
      type: 'object',
      additionalProperties: false,
      required: ['lowPrice', 'recommendedPrice', 'highPrice', 'commentary'],
      properties: {
        lowPrice: { type: 'string' },
        recommendedPrice: { type: 'string' },
        highPrice: { type: 'string' },
        commentary: { type: 'array', items: { type: 'string' } },
      },
    },
    positiveMarketFactors: { type: 'array', items: { type: 'string' } },
    negativeMarketFactors: { type: 'array', items: { type: 'string' } },
    conclusion: {
      type: 'object',
      additionalProperties: false,
      required: ['exactRecommendedPrice', 'justification'],
      properties: {
        exactRecommendedPrice: { type: 'string' },
        justification: { type: 'string' },
      },
    },
  },
};

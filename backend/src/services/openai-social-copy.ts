import OpenAI from 'openai';
import { env } from '../config/env.js';

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

export async function generateListingSocialCopy(input: ListingSocialCopyPromptData): Promise<string> {
  const apiKey = env.openai.socialCopy.apiKey;
  if (!apiKey) {
    throw new Error('OPENAI_SOCIAL_COPY_API_KEY is not configured on this server.');
  }

  const client = new OpenAI({
    apiKey,
    timeout: 60_000,
    maxRetries: 1,
  });

  let previousDraft = '';
  let validationResult: SocialCopyValidationResult | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (client as any).responses.create({
      model: env.openai.socialCopy.model,
      max_output_tokens: env.openai.socialCopy.maxOutputTokens,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: buildSystemPrompt() }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: buildUserPrompt(input, attempt, previousDraft, validationResult?.reasons ?? []) }],
        },
      ],
    });

    const outputText = extractResponseText(response);
    if (!outputText) {
      validationResult = {
        valid: false,
        sanitizedText: '',
        reasons: ['The model returned an empty response.'],
      };
      previousDraft = '';
      continue;
    }

    validationResult = validateGeneratedSocialCopy(outputText, input);
    if (validationResult.valid) {
      return validationResult.sanitizedText;
    }

    previousDraft = validationResult.sanitizedText;
  }

  const fallback = buildFallbackSocialCopy(input);
  const fallbackValidation = validateGeneratedSocialCopy(fallback, input);
  if (fallbackValidation.valid) {
    return fallbackValidation.sanitizedText;
  }

  throw new Error(`Generated social copy was incomplete and could not be repaired automatically. ${validationResult?.reasons.join(' ') ?? ''}`.trim());
}

function buildSystemPrompt(): string {
  return `You are an expert real estate social media copywriter for Keller Williams Southern Africa.

Write one social media post for the selected platform.

The copy must be accurate, professional, and based only on the listing data provided.
Do not invent features, locations, prices, statistics, guarantees, or claims.
If a field is missing, do not mention it.

The copy must sound premium, useful, and ready for public property marketing.
Use South African real estate tone and ZAR style where pricing is included.
Do not return multiple options.
Do not explain your reasoning.
Do not use long dashes. Use a normal hyphen instead.
Return only the final post text.`;
}

function buildUserPrompt(input: ListingSocialCopyPromptData, attempt = 0, previousDraft = '', previousReasons: string[] = []): string {
  const keyFeatures = input.keyFeatures.length > 0 ? input.keyFeatures.map((feature) => `- ${feature}`).join('\n') : '- None provided';
  const repairBlock = attempt > 0
    ? `

Previous draft failed validation for these reasons:
${previousReasons.map((reason) => `- ${reason}`).join('\n')}

Previous invalid draft:
${previousDraft || '[empty]'}

Rewrite the post completely and fix every issue above.`
    : '';

  return `Platform: ${input.platform}
Status Pill: ${input.statusPill}
Tone: ${input.tone}
Include Emojis: ${input.includeEmojis ? 'Yes' : 'No'}
Include Hashtags: ${input.includeHashtags ? 'Yes' : 'No'}

Listing Data:
- Listing title: ${orMissing(input.listingTitle)}
- Property type: ${orMissing(input.propertyType)}
- Sale/rental status: ${orMissing(input.saleOrRent)}
- Price: ${orMissing(input.price)}
- Bedrooms: ${orMissing(input.bedrooms)}
- Bathrooms: ${orMissing(input.bathrooms)}
- Garages/Parking: ${orMissing(input.parking)}
- Suburb: ${orMissing(input.suburb)}
- City/Province: ${orMissing(input.cityProvince)}
- Description: ${orMissing(input.description)}
- Mandate/status detail: ${orMissing(input.mandateOrStatus)}
- Listing number: ${orMissing(input.listingNumber)}
- Agent listing link: ${orMissing(input.agentListingLink)}

Key features:
${keyFeatures}

Agent Details:
- First name: ${orMissing(input.agentFirstName)}
- Full name: ${orMissing(input.agentFullName)}
- Contact number: ${orMissing(input.agentPhone)}
- Email address: ${orMissing(input.agentEmail)}
- Market Centre: ${orMissing(input.marketCentreName)}

Rules:
1. Generate only one final post.
2. Do not provide multiple options.
3. Do not include markdown headings unless they are natural for the post.
4. Always include the agent listing link.
5. Always include the agent contact details.
6. Always include the agent first name naturally where appropriate.
7. If the selected status is Sold, do not invite the reader to view the property. Focus on the successful result and congratulations.
8. If the selected status is Just Listed, make it sound like a new opportunity.
9. If the selected status is For Sale, focus on value, features and enquiry.
10. If the selected status is Price Reduced, mention the improved value and renewed buyer opportunity.
11. If the selected status is Under Offer or Pending, communicate momentum and buyer interest without presenting it as sold.
12. If the selected status is To Let or New Rental, focus on rental availability and enquiry.
13. If the selected status is Rented, focus on a successful rental outcome and agent credibility.
14. If emojis are disabled, use no emojis at all.
15. If hashtags are disabled, use no hashtags.
16. For Instagram, keep the copy punchier with better spacing and stronger hashtag usage when enabled.
17. For Facebook, allow slightly more descriptive storytelling and a clearer call to action. Use natural narrative language instead of awkward feature-dump phrasing.
18. Keep the copy compliant, accurate, professional, and suitable for public real estate marketing.
19. The final post must include these exact contact details somewhere in the post:
${input.agentFullName}
${input.agentPhone}
${input.agentEmail}
20. The final post must include this exact listing link somewhere in the post:
${input.agentListingLink}
21. If hashtags are enabled, end the post with relevant hashtags.
22. Do not end the response mid-sentence or mid-word.
23. Do not use long dashes. Use a normal hyphen instead.
24. If a price is provided, include it exactly in this format: R 11 000 000 (R + space + thousands separated by spaces, no decimals).
25. Do not output raw numeric prices like 11000000 or 11000000.00.
26. If platform is Facebook and emojis are enabled, use at most 2 subtle emojis total so the post stays premium.

Mandatory final checklist before you answer:
- Listing link included exactly
- Agent full name included exactly
- Agent phone included exactly
- Agent email included exactly
- Hashtags included if enabled
- No long dashes
- Price format uses R + space + grouped thousands with spaces when price is provided
- Single complete post only${repairBlock}

Return only the final post text.`;
}

function orMissing(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim();
  return trimmed || 'Not provided';
}

export function validateGeneratedSocialCopy(text: string, input: ListingSocialCopyPromptData): SocialCopyValidationResult {
  const sanitizedText = sanitizeSocialCopyText(text, input.price);
  const reasons: string[] = [];
  const canonicalPrice = formatZarPrice(input.price);

  if (!sanitizedText.includes(input.agentListingLink)) {
    reasons.push('The listing link is missing.');
  }
  if (!sanitizedText.includes(input.agentFullName)) {
    reasons.push('The agent full name is missing.');
  }
  if (!sanitizedText.includes(input.agentPhone)) {
    reasons.push('The agent phone number is missing.');
  }
  if (!sanitizedText.includes(input.agentEmail)) {
    reasons.push('The agent email address is missing.');
  }
  if (input.includeHashtags && !/(^|\s)#[A-Za-z0-9_]+/.test(sanitizedText)) {
    reasons.push('Hashtags were requested but are missing.');
  }
  if (!input.includeHashtags && /(^|\s)#[A-Za-z0-9_]+/.test(sanitizedText)) {
    reasons.push('Hashtags were disabled but were included.');
  }
  if (/[\u2013\u2014]/.test(sanitizedText)) {
    reasons.push('Long dashes are not allowed.');
  }
  if (canonicalPrice && !sanitizedText.includes(canonicalPrice)) {
    reasons.push(`The price is missing or not in the required format (${canonicalPrice}).`);
  }
  if (sanitizedText.length < 120) {
    reasons.push('The generated post is too short and appears incomplete.');
  }
  return {
    valid: reasons.length === 0,
    sanitizedText,
    reasons,
  };
}

export function sanitizeSocialCopyText(text: string, listingPrice?: string | null): string {
  const canonicalPrice = formatZarPrice(listingPrice);
  const normalizedPrice = normalizePriceMentions(text, canonicalPrice);

  return normalizedPrice
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildFallbackSocialCopy(input: ListingSocialCopyPromptData): string {
  const lines: string[] = [];
  const emoji = input.includeEmojis;
  const features = input.keyFeatures.slice(0, 4);
  const statusIntro = buildStatusIntro(input, emoji);
  const titleLine = input.listingTitle.trim();
  const formattedPrice = formatZarPrice(input.price);
  const priceLine = formattedPrice ? `${emoji ? 'Price: ' : ''}${formattedPrice}` : '';
  const locationLine = [input.suburb, input.cityProvince].filter(Boolean).join(', ').trim();
  const descriptionLine = compactDescription(input.description);

  lines.push(statusIntro);

  if (titleLine) lines.push(titleLine);
  if (priceLine) lines.push(priceLine);
  if (locationLine) lines.push(locationLine);

  if (input.bedrooms || input.bathrooms || input.parking) {
    const factLines = [
      input.bedrooms ? `${emoji ? 'Bedrooms: ' : ''}${input.bedrooms}` : null,
      input.bathrooms ? `${emoji ? 'Bathrooms: ' : ''}${input.bathrooms}` : null,
      input.parking ? `${emoji ? 'Parking: ' : ''}${input.parking}` : null,
    ].filter(Boolean) as string[];
    if (factLines.length > 0) {
      lines.push(factLines.join(input.platform === 'instagram' ? ' | ' : '\n'));
    }
  }

  if (features.length > 0) {
    const featureBlock = input.platform === 'facebook'
      ? buildFacebookFeatureNarrative(features, input.description)
      : `Property features: ${features.join(', ')}`;
    lines.push(featureBlock);
  }

  if (descriptionLine) lines.push(descriptionLine);

  lines.push(`View the full listing:\n${input.agentListingLink}`);
  lines.push(`Contact me:\n${input.agentFullName}\n${input.agentPhone}\n${input.agentEmail}`);

  if (input.includeHashtags) {
    lines.push(buildHashtagLine(input));
  }

  return sanitizeSocialCopyText(lines.filter(Boolean).join('\n\n'), input.price);
}

function buildStatusIntro(input: ListingSocialCopyPromptData, emoji: boolean): string {
  const marker = emoji ? ' ✨' : '';
  const status = input.statusPill.trim();
  const suburb = input.suburb?.trim() || input.cityProvince?.trim() || '';

  if (/^sold$/i.test(status)) return `Sold${suburb ? ` in ${suburb}` : ''}${marker}`;
  if (/^price reduced$/i.test(status)) return `Price Reduced${suburb ? ` in ${suburb}` : ''}${marker}`;
  if (/^under offer$/i.test(status) || /^pending$/i.test(status)) return `${status}${suburb ? ` in ${suburb}` : ''}${marker}`;
  if (/^to let$/i.test(status) || /^new rental$/i.test(status)) return `${status}${suburb ? ` in ${suburb}` : ''}${marker}`;
  if (/^rented$/i.test(status)) return `Rented${suburb ? ` in ${suburb}` : ''}${marker}`;
  return `${status}${suburb ? ` in ${suburb}` : ''}${marker}`;
}

function compactDescription(value: string | null | undefined): string {
  const text = sanitizeSocialCopyText(String(value ?? '').trim());
  if (!text) return '';
  if (text.length <= 260) return text;

  const firstSentenceMatch = text.match(/^(.{40,260}?[.!?])(?:\s|$)/);
  if (firstSentenceMatch?.[1]) {
    return firstSentenceMatch[1].trim();
  }

  const shortened = text.slice(0, 220).trim().replace(/[,:;\-\s]+$/, '');
  return shortened;
}

function buildHashtagLine(input: ListingSocialCopyPromptData): string {
  const values = [
    input.statusPill,
    input.suburb,
    input.cityProvince,
    input.propertyType,
    'KWHomes',
    input.marketCentreName,
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .map((value) => `#${value.replace(/[^A-Za-z0-9]+/g, '')}`)
    .filter((value) => value.length > 1);

  return [...new Set(values)].join(' ');
}

function formatZarPrice(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const numeric = parsePriceNumber(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) return raw;

  const grouped = Math.round(numeric).toLocaleString('en-US').replace(/,/g, ' ');
  return `R ${grouped}`;
}

function parsePriceNumber(value: string): number {
  const cleaned = value.replace(/[^0-9.,-]/g, '').trim();
  if (!cleaned) return Number.NaN;

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  if (hasComma && hasDot) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      return Number(cleaned.replace(/\./g, '').replace(',', '.'));
    }
    return Number(cleaned.replace(/,/g, ''));
  }

  if (hasComma) {
    const commaParts = cleaned.split(',');
    if (commaParts.length === 2 && commaParts[1].length <= 2) {
      return Number(cleaned.replace(',', '.'));
    }
    return Number(cleaned.replace(/,/g, ''));
  }

  if (hasDot) {
    const dotParts = cleaned.split('.');
    if (dotParts.length === 2 && dotParts[1].length <= 2) {
      return Number(cleaned);
    }
    return Number(cleaned.replace(/\./g, ''));
  }

  return Number(cleaned);
}

function normalizePriceMentions(text: string, canonicalPrice: string): string {
  if (!canonicalPrice) return text;

  const numeric = parsePriceNumber(canonicalPrice);
  if (!Number.isFinite(numeric) || numeric <= 0) return text;

  const rounded = Math.round(numeric);
  const plain = String(rounded);
  const moneyLikePattern = /(?<![A-Za-z0-9])R?\s*\d[\d\s,.]*(?:[.,]\d{2})?(?![A-Za-z0-9])/g;

  const normalized = text.replace(moneyLikePattern, (match) => {
    const digitsOnly = match.replace(/\D/g, '');
    if (!digitsOnly) return match;

    if (digitsOnly === plain) {
      return canonicalPrice;
    }

    if (digitsOnly.endsWith('00') && digitsOnly.slice(0, -2) === plain) {
      return canonicalPrice;
    }

    return match;
  });

  return normalized.replace(/\b(?:R\s*){2,}(?=\d)/gi, 'R ');
}

function buildFacebookFeatureNarrative(features: string[], description: string | null): string {
  const topFeatures = features.slice(0, 3).map((feature) => feature.trim()).filter(Boolean);
  const descriptionLine = compactDescription(description);

  if (topFeatures.length === 0) {
    return descriptionLine;
  }

  const featureSentence = topFeatures.length === 1
    ? `Highlights include ${topFeatures[0]}.`
    : topFeatures.length === 2
      ? `Highlights include ${topFeatures[0]} and ${topFeatures[1]}.`
      : `Highlights include ${topFeatures[0]}, ${topFeatures[1]} and ${topFeatures[2]}.`;

  if (!descriptionLine) {
    return featureSentence;
  }

  return `${descriptionLine}\n\n${featureSentence}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractResponseText(response: any): string {
  const direct = String(response?.output_text ?? '').trim();
  if (direct) return direct;

  const outputs = Array.isArray(response?.output) ? response.output : [];
  const parts: string[] = [];
  for (const output of outputs) {
    const content = Array.isArray(output?.content) ? output.content : [];
    for (const item of content) {
      const textValue = typeof item?.text === 'string' ? item.text.trim() : '';
      if (textValue) parts.push(textValue);
    }
  }

  return parts.join('\n').trim();
}
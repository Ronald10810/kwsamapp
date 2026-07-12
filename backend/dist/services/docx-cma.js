import fs from 'node:fs';
import { AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, ImageRun, Packer, PageBreak, PageNumber, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType, } from 'docx';
const COLORS = {
    brand: 'B40101',
    text: '282828',
    textSoft: '464646',
    footer: '5A5A5A',
    footerSoft: '787878',
    white: 'FFFFFF',
    light: 'F2F2F2',
    lighter: 'F7F7F7',
    border: 'BFBFBF',
};
const PAGE_MARGIN = { top: 907, right: 1020, bottom: 907, left: 1020 };
export async function buildCmaDocument({ cmaData, formData, logoBuffer, }) {
    const doc = new Document({
        styles: {
            default: {
                document: {
                    run: { font: 'Aptos', size: 21, color: COLORS.text },
                    paragraph: { spacing: { line: 276 } },
                },
            },
        },
        sections: [
            {
                properties: {
                    page: {
                        margin: PAGE_MARGIN,
                        size: { width: 12240, height: 15840 },
                    },
                },
                footers: { default: buildFooter(formData) },
                children: buildDocumentChildren(cmaData, formData, logoBuffer),
            },
        ],
    });
    return Packer.toBuffer(doc);
}
function buildDocumentChildren(cmaData, formData, logoBuffer) {
    return [
        buildLogoParagraph(logoBuffer),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 80 },
            children: [new TextRun({ text: 'Comparative Market Analysis', bold: true, size: 34 })],
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [new TextRun({ text: 'Prepared for seller presentation', size: 20, color: COLORS.textSoft })],
        }),
        new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, color: COLORS.brand, size: 16 } },
            spacing: { after: 180 },
        }),
        buildCoverDetailsTable(formData),
        spacer(120),
        buildPropertyMetricsTable(formData),
        spacer(100),
        new Paragraph({
            spacing: { after: 240 },
            children: [
                new TextRun({
                    text: 'Prepared from the attached LOOM property report and active public portal listings captured at generation time.',
                    size: 16,
                    color: COLORS.textSoft,
                }),
            ],
        }),
        new Paragraph({ children: [new PageBreak()] }),
        buildSectionHeading('2. Market Overview'),
        ...toBodyParagraphs(cmaData.marketOverview.areaTrends),
        ...toBodyParagraphs(cmaData.marketOverview.buyerActivity),
        ...toBodyParagraphs(cmaData.marketOverview.priceMovement),
        buildThreeColumnSummaryTable(cmaData.marketOverview),
        buildSectionHeading('3. Subject Property Overview'),
        ...toBodyParagraphs([cmaData.subjectPropertyOverview.summary]),
        ...toBulletParagraphs(cmaData.subjectPropertyOverview.highlights),
        buildSectionHeading('4. Recent Comparable Sales'),
        buildComparableSalesTable(cmaData.recentComparableSales),
        buildSectionHeading('5. Current Market Listings'),
        buildCurrentListingsTable(cmaData.currentMarketListings),
        buildSectionHeading('6. Pricing Strategy'),
        buildPricingTable(cmaData.pricingStrategy),
        ...toBodyParagraphs(cmaData.pricingStrategy.commentary),
        buildSectionHeading('7. Positive Market Factors'),
        ...toBulletParagraphs(cmaData.positiveMarketFactors),
        buildSectionHeading('8. Negative Market Factors'),
        ...toBulletParagraphs(cmaData.negativeMarketFactors),
        buildSectionHeading('9. Conclusion'),
        ...buildConclusionParagraphs(cmaData.conclusion),
    ];
}
function buildFooter(formData) {
    return new Footer({
        children: [
            new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                    new TextRun({
                        text: `${safe(formData.agentName)} | ${safe(formData.agentTitle)} | ${safe(formData.marketCentre)} | ${safe(formData.agentPhone)} | ${safe(formData.agentEmail)}`,
                        size: 17,
                        color: COLORS.footer,
                    }),
                ],
            }),
            new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                    new TextRun({ text: 'Page ', size: 17, color: COLORS.footerSoft }),
                    new TextRun({ children: [PageNumber.CURRENT], size: 17, color: COLORS.footerSoft }),
                ],
            }),
        ],
    });
}
function buildLogoParagraph(logoBuffer) {
    if (!logoBuffer) {
        return new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [
                new TextRun({ text: 'KELLER WILLIAMS', bold: true, size: 26, color: COLORS.brand }),
            ],
        });
    }
    const imageType = detectImageType(logoBuffer);
    if (!imageType) {
        return new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [
                new TextRun({ text: 'KELLER WILLIAMS', bold: true, size: 26, color: COLORS.brand }),
            ],
        });
    }
    return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
            new ImageRun({
                data: logoBuffer,
                transformation: { width: 520, height: 130 },
                type: imageType,
            }),
        ],
    });
}
function buildConclusionParagraphs(conclusion) {
    return [
        new Paragraph({
            spacing: { after: 110 },
            children: [
                new TextRun({
                    text: `Recommended asking price: ${conclusion.exactRecommendedPrice}.`,
                    bold: true,
                    size: 21,
                    color: COLORS.text,
                }),
            ],
        }),
        bodyParagraph(conclusion.justification),
    ];
}
function buildCoverDetailsTable(formData) {
    const sellerName = [formData.sellerName, formData.sellerSurname].filter(Boolean).join(' ').trim();
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: [
            detailRow('Property Address', formData.propertyAddress),
            detailRow('Property Type', formData.propertyType),
            detailRow('Prepared For', sellerName),
            detailRow('Prepared By', [
                formData.agentName,
                `${safe(formData.agentTitle)} | ${safe(formData.marketCentre)}`,
                formData.agentPhone,
                formData.agentEmail,
            ]
                .filter(Boolean)
                .join('\n')),
        ],
    });
}
function detailRow(label, value) {
    return new TableRow({
        children: [
            new TableCell({
                width: { size: 2608, type: WidthType.DXA },
                shading: { fill: COLORS.light },
                borders: tableBorders(COLORS.border),
                margins: cellMargins(120),
                children: [
                    new Paragraph({
                        children: [new TextRun({ text: label, bold: true, size: 20, color: COLORS.textSoft })],
                    }),
                ],
            }),
            new TableCell({
                width: { size: 6123, type: WidthType.DXA },
                borders: tableBorders(COLORS.border),
                margins: cellMargins(120),
                children: splitLines(value || '-').map((line) => new Paragraph({
                    children: [new TextRun({ text: line, bold: true, size: 21, color: COLORS.text })],
                })),
            }),
        ],
    });
}
function buildPropertyMetricsTable(formData) {
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: [
            new TableRow({
                children: ['Bedrooms', 'Bathrooms', 'Parking', 'Key Features'].map((label) => metricHeaderCell(label)),
            }),
            new TableRow({
                children: [
                    metricValueCell(formData.bedrooms, true),
                    metricValueCell(formData.bathrooms, true),
                    metricValueCell(formData.parking, true),
                    metricValueCell(formData.specialFeatures),
                ],
            }),
        ],
    });
}
function metricHeaderCell(label) {
    return new TableCell({
        width: { size: 2268, type: WidthType.DXA },
        shading: { fill: COLORS.brand },
        borders: tableBorders(COLORS.border),
        margins: cellMargins(100),
        children: [
            new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: label, bold: true, color: COLORS.white, size: 19 })],
            }),
        ],
    });
}
function metricValueCell(value, centered = false) {
    return new TableCell({
        width: { size: 2268, type: WidthType.DXA },
        borders: tableBorders(COLORS.border),
        margins: { top: 140, right: 120, bottom: 140, left: 120 },
        verticalAlign: VerticalAlign.CENTER,
        children: [
            new Paragraph({
                alignment: centered ? AlignmentType.CENTER : AlignmentType.LEFT,
                children: [new TextRun({ text: safe(value), bold: centered, size: 19, color: COLORS.text })],
            }),
        ],
    });
}
function buildSectionHeading(title) {
    return new Paragraph({
        spacing: { before: 180, after: 90 },
        children: [new TextRun({ text: title, bold: true, size: 24, color: COLORS.text })],
    });
}
function toBodyParagraphs(items) {
    const values = (items || []).filter(Boolean);
    if (!values.length)
        return [bodyParagraph('No additional details were available.')];
    return values.map((item) => bodyParagraph(item));
}
function bodyParagraph(text) {
    return new Paragraph({
        spacing: { after: 110 },
        children: [new TextRun({ text, size: 21, color: COLORS.text })],
    });
}
function toBulletParagraphs(items) {
    const values = (items || []).filter(Boolean);
    if (!values.length)
        return [bodyParagraph('No additional details were available.')];
    return values.map((item) => new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 90 },
        children: [new TextRun({ text: item, size: 21, color: COLORS.text })],
    }));
}
function buildThreeColumnSummaryTable(marketOverview) {
    const cards = [
        { title: 'Area Trend', lines: marketOverview.areaTrends },
        { title: 'Buyer Activity', lines: marketOverview.buyerActivity },
        { title: 'Price Movement', lines: marketOverview.priceMovement },
    ];
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: [
            new TableRow({
                children: cards.map((card) => new TableCell({
                    width: { size: 3336, type: WidthType.DXA },
                    shading: { fill: COLORS.lighter },
                    borders: tableBorders(COLORS.border),
                    margins: { top: 130, right: 130, bottom: 130, left: 130 },
                    children: [
                        new Paragraph({
                            spacing: { after: 80 },
                            children: [new TextRun({ text: card.title, bold: true, size: 20, color: COLORS.brand })],
                        }),
                        ...splitIntoParagraphs(card.lines),
                    ],
                })),
            }),
        ],
    });
}
function buildComparableSalesTable(rows) {
    const safeRows = rows?.length
        ? rows
        : [{ address: 'Comparable sale data not confirmed', beds: '-', baths: '-', parking: '-', soldPrice: '-', soldDate: '-' }];
    return buildDataTable(['Address', 'Beds', 'Baths', 'Parking', 'Sold Price', 'Sold Date'], [2530, 1355, 1355, 1355, 1687, 1687], safeRows.map((row) => [row.address, row.beds, row.baths, row.parking, row.soldPrice, row.soldDate]));
}
function buildCurrentListingsTable(listings) {
    const safeListings = listings?.length
        ? listings
        : [{ title: 'No active listings returned', propertyType: '-', beds: '-', baths: '-', price: '-', url: '' }];
    return buildDataTable(['Portal', 'Listing', 'Beds', 'Baths', 'Price', 'Link'], [1355, 2530, 1355, 1355, 1355, 1687], safeListings.map((listing) => [
        detectPortal(listing.url),
        listing.title || listing.propertyType,
        listing.beds,
        listing.baths,
        listing.price,
        { url: listing.url, label: 'View listing' },
    ]));
}
function buildPricingTable(pricingStrategy) {
    return buildDataTable(['Low Estimate', 'Recommended Price', 'High Estimate'], [3003, 3002, 3003], [[pricingStrategy.lowPrice, pricingStrategy.recommendedPrice, pricingStrategy.highPrice]], { centeredColumns: [0, 1, 2], boldCurrencyColumns: [1] });
}
function buildDataTable(headers, widths, rows, options = {}) {
    const centeredColumns = options.centeredColumns ?? [2, 3, 4];
    const boldCurrencyColumns = options.boldCurrencyColumns ?? centeredColumns;
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: [
            new TableRow({
                children: headers.map((header, index) => dataHeaderCell(header, widths[index])),
            }),
            ...rows.map((row, rowIndex) => new TableRow({
                children: row.map((value, colIndex) => dataBodyCell(value, widths[colIndex], rowIndex, centeredColumns.includes(colIndex), boldCurrencyColumns.includes(colIndex))),
            })),
        ],
    });
}
function dataHeaderCell(text, width) {
    return new TableCell({
        width: { size: width, type: WidthType.DXA },
        shading: { fill: COLORS.brand },
        borders: tableBorders(COLORS.border),
        margins: cellMargins(90),
        children: [
            new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text, bold: true, color: COLORS.white, size: 16 })],
            }),
        ],
    });
}
function dataBodyCell(value, width, rowIndex, centered = false, boldCurrency = false) {
    const fill = rowIndex % 2 === 0 ? COLORS.white : COLORS.lighter;
    const children = isLinkValue(value)
        ? [
            new Paragraph({
                alignment: centered ? AlignmentType.CENTER : AlignmentType.LEFT,
                children: value.url
                    ? [
                        new ExternalHyperlink({
                            children: [new TextRun({ text: value.label, color: COLORS.brand, underline: {} })],
                            link: value.url,
                        }),
                    ]
                    : [new TextRun({ text: '-' })],
            }),
        ]
        : [
            new Paragraph({
                alignment: centered ? AlignmentType.CENTER : AlignmentType.LEFT,
                children: [
                    new TextRun({
                        text: safe(value),
                        bold: boldCurrency && typeof value === 'string' && value.startsWith('R '),
                        size: 16,
                        color: COLORS.text,
                    }),
                ],
            }),
        ];
    return new TableCell({
        width: { size: width, type: WidthType.DXA },
        shading: { fill },
        borders: tableBorders(COLORS.border),
        margins: cellMargins(90),
        children,
    });
}
// ---- helpers ----------------------------------------------------------------
function isLinkValue(value) {
    return typeof value === 'object' && value !== null && 'url' in value;
}
function detectPortal(url) {
    if (!url)
        return '-';
    if (/property24/i.test(url))
        return 'Property24';
    if (/privateproperty/i.test(url))
        return 'Private Property';
    if (/pam golding|pamgolding/i.test(url))
        return 'Pam Golding';
    if (/seeff/i.test(url))
        return 'Seeff';
    if (/harcourts/i.test(url))
        return 'Harcourts';
    return 'Portal';
}
function detectImageType(buffer) {
    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return 'png';
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'jpg';
    }
    if (buffer.length >= 6 && buffer.subarray(0, 6).toString('ascii') === 'GIF89a') {
        return 'gif';
    }
    if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
        return 'bmp';
    }
    return null;
}
function splitLines(text) {
    return (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
}
function splitIntoParagraphs(lines) {
    return (lines || [])
        .filter(Boolean)
        .map((line) => new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: line, size: 18, color: COLORS.text })] }));
}
function spacer(space) {
    return new Paragraph({ spacing: { after: space } });
}
function safe(value) {
    return value?.trim() || '-';
}
function tableBorders(color) {
    const border = { style: BorderStyle.SINGLE, color, size: 4 };
    return { top: border, bottom: border, left: border, right: border, insideH: border, insideV: border };
}
function cellMargins(size) {
    return { top: size, right: size, bottom: size, left: size };
}
// suppress unused import warning — fs used as type import guard only
void fs;
//# sourceMappingURL=docx-cma.js.map
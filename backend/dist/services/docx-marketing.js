import { AlignmentType, BorderStyle, Document, Footer, ImageRun, Packer, PageBreak, PageNumber, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType, } from 'docx';
const COLORS = {
    brand: 'B40101',
    text: '282828',
    textSoft: '4A4A4A',
    border: 'C8C8C8',
    light: 'F5F5F5',
    lighter: 'FAFAFA',
    white: 'FFFFFF',
};
const PAGE_MARGIN = { top: 907, right: 1020, bottom: 907, left: 1020 };
export async function buildMarketingPlanDocument({ marketingPlanData, formData, logoBuffer, }) {
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
                footers: {
                    default: new Footer({
                        children: [
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                children: [
                                    new TextRun({
                                        text: `${safe(formData.agentName)} | ${safe(formData.agencyBrand)} | ${safe(formData.agentPhone)} | ${safe(formData.agentEmail)}`,
                                        size: 17,
                                        color: '666666',
                                    }),
                                ],
                            }),
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                children: [
                                    new TextRun({ text: 'Page ', size: 17, color: '808080' }),
                                    new TextRun({ children: [PageNumber.CURRENT], size: 17, color: '808080' }),
                                ],
                            }),
                        ],
                    }),
                },
                children: buildChildren(marketingPlanData, logoBuffer),
            },
        ],
    });
    return Packer.toBuffer(doc);
}
function buildChildren(data, logoBuffer) {
    const children = [];
    children.push(buildLogoParagraph(logoBuffer));
    children.push(sectionHeading('1. Cover Page'));
    children.push(centeredTitle(data.coverPage.documentTitle || 'Marketing Plan'), centeredSubTitle(safe(data.coverPage.propertyAddress)), centeredSubTitle(`Prepared by: ${safe(data.coverPage.preparedBy)}`), centeredSubTitle(`Agency / Brand: ${safe(data.coverPage.agencyBrand)}`), centeredSubTitle(`Prepared for: ${safe(data.coverPage.preparedFor)}`), centeredSubTitle(`Date: ${safe(data.coverPage.datePrepared)}`));
    children.push(sectionHeading('2. Property Snapshot'));
    children.push(...bodyParagraphs(data.propertySnapshot.summary));
    children.push(tableFromRows(['Field', 'Value'], data.propertySnapshot.keyFacts.map((r) => [r.field, r.value])));
    children.push(sectionHeading('3. Pricing and Positioning Summary'));
    children.push(...bodyParagraphs(data.pricingAndPositioningSummary.summaryParagraphs));
    children.push(tableFromRows(['Metric', 'Value', 'Note'], data.pricingAndPositioningSummary.pricingTable.map((r) => [r.metric, r.value, r.note])));
    children.push(sectionHeading('4. Unique Selling Points and Target Buyer Profiles'));
    children.push(subHeading('Unique Selling Points'));
    children.push(...bulletParagraphs(data.uniqueSellingPointsAndTargetBuyerProfiles.uniqueSellingPoints));
    children.push(subHeading('Target Buyer Profiles'));
    for (const p of data.uniqueSellingPointsAndTargetBuyerProfiles.targetBuyerProfiles) {
        children.push(bodyParagraph(`${safe(p.profileName)}: ${safe(p.profileSummary)}`));
        children.push(...bulletParagraphs(p.matchingFeatures));
    }
    children.push(subHeading('Messaging Angles'));
    children.push(...bulletParagraphs(data.uniqueSellingPointsAndTargetBuyerProfiles.messagingAngles));
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(sectionHeading('5. 4-Week Marketing Strategy Overview'));
    children.push(...bodyParagraphs(data.fourWeekMarketingStrategyOverview.strategySummary));
    children.push(tableFromRows(['Week', 'Objective', 'Channels', 'Actions', 'Expected Outcome'], data.fourWeekMarketingStrategyOverview.weeklyPlan.map((r) => [r.week, r.objective, r.channels, r.actions, r.expectedOutcome])));
    children.push(sectionHeading('6. Online Listing Copy'));
    children.push(subHeading('Property24 Title'));
    children.push(bodyParagraph(data.onlineListingCopy.property24Title));
    children.push(subHeading('Property24 Full Description'));
    children.push(...bodyParagraphs(data.onlineListingCopy.property24FullDescription));
    children.push(subHeading('Short Title'));
    children.push(bodyParagraph(data.onlineListingCopy.shortTitle));
    children.push(subHeading('Short Description'));
    children.push(bodyParagraph(data.onlineListingCopy.shortDescription));
    children.push(subHeading('Optional Hook Lines'));
    children.push(...bulletParagraphs(data.onlineListingCopy.optionalHookLines));
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(sectionHeading('7. Social Media and Paid Ads Plan'));
    children.push(...bodyParagraphs(data.socialMediaAndPaidAdsPlan.platformGuidance));
    children.push(tableFromRows(['Week', 'Platform', 'Theme', 'Visual Idea', 'Caption', 'CTA', 'Hashtags'], data.socialMediaAndPaidAdsPlan.posts.map((r) => [r.week, r.platform, r.theme, r.visualIdea, r.caption, r.cta, r.hashtags])));
    children.push(subHeading('Paid Ads Concepts'));
    children.push(tableFromRows(['Concept', 'Creative Direction', 'Ad Copy', 'Targeting'], data.socialMediaAndPaidAdsPlan.paidAds.map((r) => [r.conceptName, r.creativeDirection, r.adCopy, r.targeting])));
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(sectionHeading('8. Buyer Database and Follow-Up Campaign'));
    children.push(...bodyParagraphs(data.buyerDatabaseAndFollowUpCampaign.targetingApproach));
    children.push(tableFromRows(['Day/Week', 'Channel', 'Objective', 'Script / Message'], data.buyerDatabaseAndFollowUpCampaign.timeline.map((r) => [r.dayOrWeek, r.channel, r.objective, r.fullScriptOrMessage])));
    children.push(subHeading('Compliance Notes'));
    children.push(...bulletParagraphs(data.buyerDatabaseAndFollowUpCampaign.complianceNotes));
    children.push(sectionHeading('9. Media and Asset Checklist'));
    children.push(tableFromRows(['Item', 'Owner', 'Due Date', 'Status', 'Notes'], data.mediaAndAssetChecklist.map((r) => [r.item, r.owner, r.dueDate, r.status, r.notes])));
    children.push(sectionHeading('10. Reporting and Feedback Schedule'));
    children.push(tableFromRows(['Timing', 'Activity', 'Output', 'Owner'], data.reportingAndFeedbackSchedule.map((r) => [r.timing, r.activity, r.output, r.owner])));
    children.push(sectionHeading('11. Next Steps and Approvals'));
    children.push(subHeading('Next Steps'));
    children.push(...bulletParagraphs(data.nextStepsAndApprovals.nextSteps));
    children.push(subHeading('Approvals Required'));
    children.push(...bulletParagraphs(data.nextStepsAndApprovals.approvalsRequired));
    children.push(subHeading('Seller Approval'));
    children.push(...bodyParagraphs(data.nextStepsAndApprovals.sellerApprovalBlock));
    children.push(bodyParagraph('[ ] Approved to proceed with this marketing plan'));
    children.push(bodyParagraph('[ ] Approved with amendments (specify below)'));
    children.push(bodyParagraph('Seller Name: ____________________________'));
    children.push(bodyParagraph('Seller Signature: _________________________ Date: ______________'));
    return children;
}
function sectionHeading(text) {
    return new Paragraph({
        spacing: { before: 240, after: 120 },
        children: [new TextRun({ text, bold: true, size: 26, color: COLORS.brand })],
    });
}
function subHeading(text) {
    return new Paragraph({
        spacing: { before: 180, after: 80 },
        children: [new TextRun({ text, bold: true, size: 22, color: COLORS.text })],
    });
}
function centeredTitle(text) {
    return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 220, after: 120 },
        children: [new TextRun({ text: safe(text), bold: true, size: 36, color: COLORS.text })],
    });
}
function centeredSubTitle(text) {
    return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 70 },
        children: [new TextRun({ text: safe(text), size: 22, color: COLORS.textSoft })],
    });
}
function bodyParagraph(text) {
    return new Paragraph({
        spacing: { after: 110 },
        children: [new TextRun({ text: safe(text), size: 21, color: COLORS.text })],
    });
}
function buildLogoParagraph(logoBuffer) {
    if (!logoBuffer) {
        return new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 140 },
            children: [new TextRun({ text: 'KELLER WILLIAMS', bold: true, size: 26, color: COLORS.brand })],
        });
    }
    const imageType = detectImageType(logoBuffer);
    if (!imageType) {
        return new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 140 },
            children: [new TextRun({ text: 'KELLER WILLIAMS', bold: true, size: 26, color: COLORS.brand })],
        });
    }
    return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 140 },
        children: [
            new ImageRun({
                data: logoBuffer,
                transformation: { width: 520, height: 130 },
                type: imageType,
            }),
        ],
    });
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
function bodyParagraphs(items) {
    const arr = (items ?? []).filter(Boolean);
    if (!arr.length)
        return [bodyParagraph('[CONFIRM: Add details]')];
    return arr.map((item) => bodyParagraph(item));
}
function bulletParagraphs(items) {
    const arr = (items ?? []).filter(Boolean);
    if (!arr.length)
        return [bodyParagraph('[CONFIRM: Add details]')];
    return arr.map((item) => new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 70 },
        children: [new TextRun({ text: safe(item), size: 21, color: COLORS.text })],
    }));
}
function tableFromRows(headers, rows) {
    const cellWidthPercent = Math.max(10, Math.floor(100 / headers.length));
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: [
            new TableRow({
                children: headers.map((header) => new TableCell({
                    width: { size: cellWidthPercent, type: WidthType.PERCENTAGE },
                    shading: { fill: COLORS.brand },
                    borders: tableBorders(),
                    verticalAlign: VerticalAlign.CENTER,
                    margins: cellMargins(95),
                    children: [
                        new Paragraph({
                            spacing: { after: 40 },
                            children: [new TextRun({ text: safe(header), bold: true, color: COLORS.white, size: 19 })],
                        }),
                    ],
                })),
            }),
            ...rows.map((row, rowIndex) => new TableRow({
                children: row.map((col) => new TableCell({
                    width: { size: cellWidthPercent, type: WidthType.PERCENTAGE },
                    shading: { fill: rowIndex % 2 === 0 ? COLORS.lighter : COLORS.light },
                    borders: tableBorders(),
                    verticalAlign: VerticalAlign.CENTER,
                    margins: cellMargins(85),
                    children: [
                        new Paragraph({
                            spacing: { after: 35 },
                            children: [new TextRun({ text: safe(col), size: 18, color: COLORS.text })],
                        }),
                    ],
                })),
            })),
        ],
    });
}
function tableBorders() {
    return {
        top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
        left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
        right: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
    };
}
function cellMargins(all) {
    return {
        top: all,
        bottom: all,
        left: all,
        right: all,
    };
}
function safe(value) {
    const v = value?.trim();
    return v && v.length ? v : '[CONFIRM: Add details]';
}
//# sourceMappingURL=docx-marketing.js.map
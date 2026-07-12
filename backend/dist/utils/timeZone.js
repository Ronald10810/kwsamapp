import { env } from '../config/env.js';
const DEFAULT_TIME_ZONE = 'Africa/Johannesburg';
function formatDateInTimeZone(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
    const month = parts.find((part) => part.type === 'month')?.value ?? '01';
    const day = parts.find((part) => part.type === 'day')?.value ?? '01';
    return `${year}-${month}-${day}`;
}
export function getAppTimeZone() {
    return env.appTimeZone || DEFAULT_TIME_ZONE;
}
export function getTodayInAppTimeZone(date = new Date()) {
    return formatDateInTimeZone(date, getAppTimeZone());
}
export function getFirstOfMonthInAppTimeZone(date = new Date()) {
    const firstDay = new Date(date);
    firstDay.setDate(1);
    return formatDateInTimeZone(firstDay, getAppTimeZone());
}
//# sourceMappingURL=timeZone.js.map
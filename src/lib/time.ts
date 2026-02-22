import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

export const JAKARTA_TZ = "Asia/Jakarta";
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function getJakartaDate() {
  return dayjs().tz(JAKARTA_TZ);
}

function toDateOnlyString(dateString?: string) {
  if (dateString && DATE_ONLY_PATTERN.test(dateString)) {
    return dateString;
  }
  return getJakartaDate().format("YYYY-MM-DD");
}

export function toEventDate(dateString?: string) {
  const dateOnly = toDateOnlyString(dateString);
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

export function eventDateToKey(date: Date) {
  return dayjs.utc(date).format("YYYY-MM-DD");
}

export function formatJakartaDate(date?: Date) {
  if (!date) {
    return "";
  }
  return eventDateToKey(date);
}

export function isSunday(date: Date) {
  return dayjs.utc(date).day() === 0;
}

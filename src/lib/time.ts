import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

export const JAKARTA_TZ = "Asia/Jakarta";

export function getJakartaDate() {
  return dayjs().tz(JAKARTA_TZ);
}

export function toEventDate(dateString?: string) {
  if (dateString) {
    return dayjs.tz(dateString, JAKARTA_TZ).startOf("day").toDate();
  }
  return getJakartaDate().startOf("day").toDate();
}

export function formatJakartaDate(date?: Date) {
  return dayjs(date).tz(JAKARTA_TZ).format("YYYY-MM-DD");
}

export function isSunday(date: Date) {
  return dayjs(date).tz(JAKARTA_TZ).day() === 0;
}

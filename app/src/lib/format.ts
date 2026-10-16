const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });
const day = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

export const timeOf = (d: string | number | Date) => time.format(new Date(d)).toLowerCase();
export const dayOf = (d: string | number | Date) => day.format(new Date(d));

export function isToday(d: string | number | Date) {
  return new Date(d).toDateString() === new Date().toDateString();
}

export function when(d: string | number | Date) {
  return isToday(d) ? `Today, ${timeOf(d)}` : `${dayOf(d)}, ${timeOf(d)}`;
}

export function countdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Evening' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
}

const TITLES = /^(dr|prof|mr|mrs|ms)\.?$/i;

/** "Ananya Iyer" -> "Ananya", but "Dr. Meera Nair" -> "Dr. Nair". */
export function firstName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 && TITLES.test(parts[0]) ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0];
}

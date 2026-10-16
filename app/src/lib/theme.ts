// "Department notice board": warm paper, dark ink, one loud signal colour.
export const colors = {
  paper: '#F3EEE3',
  card: '#FBF8F1',
  sunk: '#EAE3D4',
  ink: '#1E1A16',
  inkSoft: '#4F473E',
  muted: '#6E6558',
  line: '#DCD3C1',
  // Text/buttons use the deeper orange (4.7:1 on paper); `signal` is for rings and bars.
  accent: '#B8441E',
  signal: '#E2552B',
  accentSoft: '#F7DCCF',
  ok: '#2E7D4F',
  okSoft: '#D8EBDD',
  warn: '#A86A12',
  warnSoft: '#F4E5C6',
  danger: '#B3261E',
  dangerSoft: '#F4D7D3',
  white: '#FFFFFF',
};

export const fonts = {
  display: 'Fraunces_600SemiBold',
  displayItalic: 'Fraunces_400Regular_Italic',
  body: 'InstrumentSans_400Regular',
  medium: 'InstrumentSans_500Medium',
  semibold: 'InstrumentSans_600SemiBold',
  bold: 'InstrumentSans_700Bold',
  mono: 'JetBrainsMono_500Medium',
};

export const space = (n: number) => n * 4;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 };

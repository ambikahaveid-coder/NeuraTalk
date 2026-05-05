export const premiumTheme = {
  colors: {
    background: '#050B1A',
    backgroundAlt: '#0A1228',
    surface: 'rgba(15, 23, 42, 0.48)',
    surfaceStrong: 'rgba(14, 24, 47, 0.72)',
    border: 'rgba(255,255,255,0.12)',
    borderStrong: 'rgba(130, 156, 255, 0.24)',
    text: '#F8FBFF',
    textMuted: 'rgba(234, 242, 255, 0.68)',
    textSoft: 'rgba(214, 226, 255, 0.48)',
    blue: '#4F7BFF',
    purple: '#8A5CFF',
    cyan: '#67E8F9',
    green: '#34D399',
    amber: '#FBBF24',
    red: '#FB7185',
  },
  radius: {
    xl: 28,
    lg: 22,
    md: 18,
    sm: 14,
    pill: 999,
  },
};

export const glass = {
  backgroundColor: premiumTheme.colors.surface,
  borderColor: premiumTheme.colors.border,
  borderWidth: 1,
};

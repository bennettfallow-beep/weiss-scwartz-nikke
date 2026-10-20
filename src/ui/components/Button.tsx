import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, minTouch, space } from '../theme';

interface Props {
  label: string;
  detail?: string | undefined;
  onPress: () => void;
  tone?: 'primary' | 'neutral' | 'danger' | 'quiet';
  testID?: string;
  disabled?: boolean;
  /** Shown on the right, e.g. "✓ Selected" (never color alone). */
  badge?: string | undefined;
}

/** A labelled button, at least 44 points tall. */
export function Button({ label, detail, onPress, tone = 'neutral', testID, disabled = false, badge }: Props) {
  const style = tone === 'primary' ? styles.primary : tone === 'danger' ? styles.danger : tone === 'quiet' ? styles.quiet : styles.neutral;
  const ink = tone === 'primary' ? styles.primaryInk : tone === 'danger' ? styles.dangerInk : styles.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.base, style, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View style={styles.row}>
        <View style={styles.texts}>
          <Text style={[styles.label, ink]}>{label}</Text>
          {detail ? <Text style={[styles.detail, ink]}>{detail}</Text> : null}
        </View>
        {badge ? <Text style={[styles.badge, ink]}>{badge}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: minTouch, borderRadius: 10, paddingHorizontal: space.m, paddingVertical: space.s, justifyContent: 'center', borderWidth: 1 },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  neutral: { backgroundColor: colors.panelHigh, borderColor: colors.line },
  danger: { backgroundColor: colors.panel, borderColor: colors.danger },
  quiet: { backgroundColor: 'transparent', borderColor: colors.line },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  texts: { flex: 1 },
  label: { fontSize: font.body, fontWeight: '600' },
  detail: { fontSize: font.small, marginTop: 2 },
  badge: { fontSize: font.small, fontWeight: '700' },
  ink: { color: colors.text },
  primaryInk: { color: colors.accentInk },
  dangerInk: { color: colors.danger },
});

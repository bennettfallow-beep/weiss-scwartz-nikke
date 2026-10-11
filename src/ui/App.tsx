import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

import { RULES_SOURCE } from '../engine';
import { colors } from './theme';

// M0 toolchain spike: proves the app builds for web and native and can import
// the pure engine. Real screens arrive in M5.
export default function App() {
  return (
    <View style={styles.container} testID="home-screen">
      <Text style={styles.title} accessibilityRole="header">
        Frontline Duel
      </Text>
      <Text style={styles.body}>A two-player card battler. Rules engine in progress.</Text>
      <Text style={styles.meta} testID="rules-version">
        Rules: {RULES_SOURCE.document} v{RULES_SOURCE.version}
      </Text>
      <Text style={styles.disclaimer}>Unofficial fan project. Not affiliated with or endorsed by Bushiroad.</Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 12,
  },
  title: { color: colors.accent, fontSize: 28, fontWeight: '700' },
  body: { color: colors.text, fontSize: 16, textAlign: 'center' },
  meta: { color: colors.dim, fontSize: 13, textAlign: 'center' },
  disclaimer: { color: colors.dim, fontSize: 12, textAlign: 'center', marginTop: 24 },
});

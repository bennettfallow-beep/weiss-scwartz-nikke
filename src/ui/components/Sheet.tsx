import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, font, space } from '../theme';
import { Button } from './Button';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
}

/** A panel over the screen with a title, scrolling content and a Close button. Rendered only while open. */
export function Sheet({ title, onClose, children, testID }: Props) {
  return (
    <View style={styles.backdrop} testID={testID}>
      <Pressable style={styles.outside} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <View style={styles.close}>
            <Button label="Close" onPress={onClose} tone="quiet" testID="sheet-close" />
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.body}>{children}</ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(5,6,8,0.78)', justifyContent: 'flex-end' },
  outside: { flex: 1 },
  sheet: { maxHeight: '88%', backgroundColor: colors.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, borderColor: colors.line, paddingBottom: space.l },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.l, paddingTop: space.m, gap: space.s },
  title: { flex: 1, color: colors.text, fontSize: font.title, fontWeight: '700' },
  close: { width: 96 },
  body: { padding: space.l, gap: space.s },
});

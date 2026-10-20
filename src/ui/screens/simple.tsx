// The screens around the board: home, new game, handoff, game over and help.

import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { RULES_SOURCE } from '../../engine';
import type { GameOverModel, HandoffModel, Mode } from '../../session';
import { Button } from '../components/Button';
import { HELP } from '../content/help';
import { colors, font, space } from '../theme';

const DECK_LABELS: readonly [string, string][] = [
  ['yellow', 'Yellow deck'],
  ['red', 'Red deck'],
  ['blue', 'Blue deck'],
];

export function HomeScreen({ onMode, onHelp }: { onMode: (m: Mode) => void; onHelp: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.page} testID="home-screen">
      <Text style={styles.brand} accessibilityRole="header">
        Frontline Duel
      </Text>
      <Text style={styles.body}>A two-player card battler.</Text>
      <View style={styles.stack}>
        <Button label="Two players, one phone" detail="Pass the phone between turns" tone="primary" onPress={() => onMode('hotseat')} testID="home-hotseat" />
        <Button label="Play against the computer" tone="primary" onPress={() => onMode('computer')} testID="home-computer" />
        <Button label="How to play" onPress={onHelp} testID="home-help" />
      </View>
      <Text style={styles.meta} testID="rules-version">
        Rules: {RULES_SOURCE.document} v{RULES_SOURCE.version}
      </Text>
      <Text style={styles.meta}>Unofficial fan project. Not affiliated with or endorsed by Bushiroad.</Text>
    </ScrollView>
  );
}

export function NewGameScreen({ mode, onStart, onBack }: { mode: Mode; onStart: (decks: [string, string]) => void; onBack: () => void }) {
  const [decks, setDecks] = useState<[string, string]>(['yellow', 'red']);
  const seats = mode === 'hotseat' ? ['Player 1', 'Player 2'] : ['Your deck', 'Computer’s deck'];
  return (
    <ScrollView contentContainerStyle={styles.page} testID="newgame-screen">
      <Text style={styles.title} accessibilityRole="header">
        {mode === 'hotseat' ? 'Two players, one phone' : 'Against the computer'}
      </Text>
      {[0, 1].map((seat) => (
        <View key={seat} style={styles.stack}>
          <Text style={styles.label}>{seats[seat]}</Text>
          {DECK_LABELS.map(([key, label]) => {
            const chosen = decks[seat] === key;
            return (
              <Button
                key={key}
                label={label}
                tone={chosen ? 'primary' : 'neutral'}
                badge={chosen ? '✓ Selected' : undefined}
                accessibilityLabel={`${seats[seat] ?? ''}: ${label}${chosen ? ', selected' : ''}`}
                onPress={() => setDecks((d) => (seat === 0 ? [key, d[1]] : [d[0], key]))}
                testID={`deck-${seat}-${key}`}
              />
            );
          })}
        </View>
      ))}
      <Text style={styles.meta}>Who goes first is decided at random.</Text>
      <View style={styles.stack}>
        <Button label="Start game" tone="primary" onPress={() => onStart(decks)} testID="newgame-start" />
        <Button label="Back" tone="quiet" onPress={onBack} testID="newgame-back" />
      </View>
    </ScrollView>
  );
}

/** Hot-seat: nothing about any card is on this screen, by design. */
export function HandoffScreen({ model, onContinue }: { model: HandoffModel; onContinue: () => void }) {
  return (
    <View style={[styles.page, styles.center]} testID="handoff-screen">
      <Text style={styles.title} accessibilityRole="header">
        Pass the phone to {model.toName}
      </Text>
      <Text style={styles.body}>{model.context}</Text>
      {model.first ? <Text style={styles.body}>{model.first}</Text> : null}
      <Text style={styles.meta}>Continue only when {model.toName} is holding the phone.</Text>
      <View style={styles.stack}>
        <Button label={`I’m ${model.toName}: show my cards`} tone="primary" onPress={onContinue} testID="handoff-continue" />
      </View>
    </View>
  );
}

export function GameOverScreen({ model, onRematch, onNew, onHome }: { model: GameOverModel; onRematch: () => void; onNew: () => void; onHome: () => void }) {
  return (
    <View style={[styles.page, styles.center]} testID="gameover-screen">
      <Text style={styles.title} accessibilityRole="header" testID="gameover-title">
        {model.title}
      </Text>
      <Text style={styles.body} testID="gameover-result">
        {model.text}
      </Text>
      <Text style={styles.meta}>{model.turns === 0 ? 'The game ended before the first turn.' : `The game lasted ${model.turns} turn${model.turns === 1 ? '' : 's'}.`}</Text>
      <View style={styles.stack}>
        <Button label="Rematch" detail="Same decks, new shuffle" tone="primary" onPress={onRematch} testID="gameover-rematch" />
        <Button label="New game" onPress={onNew} testID="gameover-new" />
        <Button label="Home" tone="quiet" onPress={onHome} testID="gameover-home" />
      </View>
    </View>
  );
}

export function HelpScreen({ onBack }: { onBack: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.page} testID="help-screen">
      <Text style={styles.title} accessibilityRole="header">
        How to play
      </Text>
      {HELP.map((s) => (
        <View key={s.title} style={styles.section}>
          <Text style={styles.label} accessibilityRole="header">
            {s.title}
          </Text>
          {s.paragraphs.map((p) => (
            <Text key={p} style={styles.body}>
              {p}
            </Text>
          ))}
        </View>
      ))}
      <Button label="Back" tone="quiet" onPress={onBack} testID="help-back" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: colors.bg, padding: space.l, gap: space.m },
  center: { flex: 1, justifyContent: 'center' },
  stack: { gap: space.s, alignSelf: 'stretch', width: '100%', maxWidth: 520 },
  section: { gap: space.xs },
  brand: { color: colors.accent, fontSize: 28, fontWeight: '700', marginTop: space.xl },
  title: { color: colors.text, fontSize: font.big, fontWeight: '700' },
  label: { color: colors.text, fontSize: font.title, fontWeight: '700' },
  body: { color: colors.text, fontSize: font.body, lineHeight: 21 },
  meta: { color: colors.dim, fontSize: font.small },
});

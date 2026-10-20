// Panels over the board: the log, a card's full text, a zone's cards, the menu and the concede check.

import { StyleSheet, Text, View } from 'react-native';

import type { CardDetail, CardTile as Tile, LogLine } from '../../session';
import { Button } from '../components/Button';
import { CardTile } from '../components/CardTile';
import { Sheet } from '../components/Sheet';
import { colors, font, space } from '../theme';

/** Turns newest first; within a turn, lines in the order they happened. */
function byTurn(lines: readonly LogLine[]): LogLine[][] {
  const groups: LogLine[][] = [];
  for (const l of lines) {
    const last = groups[groups.length - 1];
    if (!last || l.kind === 'turn') groups.push([l]);
    else last.push(l);
  }
  return groups.reverse();
}

export function LogSheet({ lines, onClose }: { lines: readonly LogLine[]; onClose: () => void }) {
  return (
    <Sheet title="Game log" onClose={onClose} testID="log-sheet">
      {lines.length === 0 ? <Text style={styles.dim}>Nothing yet.</Text> : null}
      {byTurn(lines).map((group) => (
        <View key={group[0]?.key ?? 'start'} style={styles.turnGroup}>
          {group.map((l) => (
            <Text key={l.key} style={[styles.line, l.kind === 'turn' && styles.turn, l.kind === 'result' && styles.result]}>
              {l.text}
            </Text>
          ))}
        </View>
      ))}
    </Sheet>
  );
}

export function CardSheet({ detail, onClose }: { detail: CardDetail; onClose: () => void }) {
  const stats = [
    detail.kind,
    detail.color,
    detail.level !== undefined ? `Level ${detail.level}` : '',
    detail.cost !== undefined ? `Cost ${detail.cost}` : '',
    detail.power !== undefined ? `Power ${detail.power}` : '',
    detail.soul !== undefined ? `Soul ${detail.soul}` : '',
  ].filter((x) => x !== '');
  return (
    <Sheet title={detail.name} onClose={onClose} testID="card-detail">
      <Text style={styles.dim}>{detail.number}</Text>
      <Text style={styles.line}>{stats.join(' · ')}</Text>
      {detail.traits.length > 0 ? <Text style={styles.line}>Traits: {detail.traits.join(', ')}</Text> : null}
      {detail.triggers.length > 0 ? <Text style={styles.line}>Trigger icons: {detail.triggers.join(', ')}</Text> : null}
      {detail.counter ? <Text style={styles.line}>Counter: can be played in the opponent’s counter step.</Text> : null}
      {detail.backup ? <Text style={styles.line}>{detail.backup}</Text> : null}
      {detail.lines.map((l) => (
        <Text key={l} style={styles.text}>
          {l}
        </Text>
      ))}
      {detail.unimplemented.length > 0 ? <Text style={styles.dim}>Not playable yet: {detail.unimplemented.join(' / ')}</Text> : null}
    </Sheet>
  );
}

export function ZoneSheet({ title, tiles, onCard, onClose }: { title: string; tiles: readonly Tile[]; onCard: (defId: string) => void; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose} testID="zone-sheet">
      {tiles.length === 0 ? <Text style={styles.dim}>No cards.</Text> : null}
      <View style={styles.grid}>
        {[...tiles].reverse().map((t) => (
          <CardTile key={t.id} tile={t} onPress={() => onCard(t.defId)} />
        ))}
      </View>
    </Sheet>
  );
}

export function MenuSheet({ onHelp, onConcede, onQuit, onClose, canConcede }: { onHelp: () => void; onConcede: () => void; onQuit: () => void; onClose: () => void; canConcede: boolean }) {
  return (
    <Sheet title="Menu" onClose={onClose} testID="menu-sheet">
      <Button label="How to play" onPress={onHelp} testID="menu-help" />
      {canConcede ? <Button label="Concede this game" tone="danger" onPress={onConcede} testID="menu-concede" /> : null}
      <Button label="Quit to home" detail="The game is not saved" onPress={onQuit} testID="menu-quit" />
    </Sheet>
  );
}

export function ConcedeSheet({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <Sheet title="Concede?" onClose={onCancel} testID="concede-dialog">
      <Text style={styles.text}>You lose this game at once.</Text>
      <Button label="Yes, concede" tone="danger" onPress={onConfirm} testID="concede-confirm" />
      <Button label="Keep playing" onPress={onCancel} testID="concede-cancel" />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  line: { color: colors.text, fontSize: font.small },
  text: { color: colors.text, fontSize: font.body, lineHeight: 21 },
  dim: { color: colors.dim, fontSize: font.small },
  turn: { color: colors.accent, fontWeight: '700', marginTop: space.s },
  result: { color: colors.ok, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  turnGroup: { gap: 2 },
});

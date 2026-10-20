import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CardTile as Tile, StageTile } from '../../session';
import { cardColors, colors, font, space } from '../theme';

function isStage(t: Tile | StageTile): t is StageTile {
  return 'orientation' in t;
}

function n(x: number): string {
  const sign = x < 0 ? '-' : '';
  return sign + String(Math.abs(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

interface Props {
  tile: Tile | StageTile;
  onPress?: () => void;
  onLongPress?: () => void;
  /** It has choices in the current prompt. */
  active?: boolean;
  /** Selected: its choices are in the tray. */
  selected?: boolean;
  /** Mulligan: marked to put back. */
  marked?: boolean;
  width?: number;
  testID?: string;
}

/** A card face in words: name, color, level/cost, power/soul, icons; on the stage, its orientation and current values. */
export function CardTile({ tile, onPress, onLongPress, active = false, selected = false, marked = false, width = 96, testID }: Props) {
  const stage = isStage(tile) ? tile : null;
  const stats: string[] = [];
  if (tile.level !== undefined) stats.push(`Lv${tile.level}`);
  if (tile.cost !== undefined) stats.push(`Cost ${tile.cost}`);
  const power = stage ? stage.powerNow : tile.power;
  const soul = stage ? stage.soulNow : tile.soul;
  // Changes are written out, not only colored.
  const powerDiff = stage ? stage.powerNow - (tile.power ?? 0) : 0;
  const soulDiff = stage ? stage.soulNow - (tile.soul ?? 0) : 0;
  const flags = [selected ? 'Selected' : '', marked ? 'Put back' : '', active && !selected ? 'Can act' : ''].filter((x) => x !== '');
  const label = [tile.name, tile.color, tile.kind, stats.join(', '), power !== undefined ? `power ${power}` : '', soul !== undefined ? `soul ${soul}` : '', stage ? stage.orientation : '', ...flags]
    .filter((x) => x !== '')
    .join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onLongPress={onLongPress}
      testID={testID}
      style={[
        styles.card,
        { width, borderLeftColor: cardColors[tile.colorKey] },
        active && styles.active,
        selected && styles.selected,
        marked && styles.marked,
        stage?.orientationKey === 'rest' && styles.rested,
        stage?.orientationKey === 'reverse' && styles.reversed,
      ]}
    >
      <Text style={styles.name} numberOfLines={2}>
        {tile.name}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {tile.color}
        {tile.kind !== 'Character' ? ` · ${tile.kind}` : ''}
      </Text>
      {stats.length > 0 ? <Text style={styles.meta}>{stats.join(' · ')}</Text> : null}
      {power !== undefined ? (
        <Text style={[styles.power, stage?.changed && styles.changed]}>
          {n(power)}
          {powerDiff !== 0 ? ` (${powerDiff > 0 ? '+' : ''}${n(powerDiff)})` : ''}
          {soul !== undefined ? ` · Soul ${soul}` : ''}
          {soulDiff !== 0 ? ` (${soulDiff > 0 ? '+' : ''}${soulDiff})` : ''}
        </Text>
      ) : null}
      {tile.triggers.length > 0 ? <Text style={styles.meta}>{tile.triggers.join(', ')}</Text> : null}
      {stage ? <Text style={[styles.state, stage.orientationKey === 'reverse' && styles.stateReversed]}>{stage.orientation}</Text> : null}
      {flags.length > 0 ? <Text style={styles.flag}>{flags[0]}</Text> : null}
    </Pressable>
  );
}

/** An empty stage position. */
export function EmptySlot({ label, width = 96, testID }: { label: string; width?: number; testID?: string }) {
  return (
    <View style={[styles.card, styles.empty, { width }]} testID={testID} accessibilityLabel={`${label}: empty`}>
      <Text style={styles.emptyText}>{label}</Text>
      <Text style={styles.emptyText}>Empty</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 92,
    backgroundColor: colors.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: 5,
    padding: space.xs + 2,
    gap: 1,
  },
  active: { borderColor: colors.accent },
  selected: { borderColor: colors.accent, backgroundColor: colors.panelHigh, borderWidth: 2, borderLeftWidth: 5 },
  marked: { borderColor: colors.danger, borderWidth: 2, borderLeftWidth: 5 },
  rested: { opacity: 0.8 },
  reversed: { opacity: 0.65 },
  name: { color: colors.text, fontSize: 13, fontWeight: '700' },
  meta: { color: colors.dim, fontSize: 11 },
  power: { color: colors.text, fontSize: font.small, fontWeight: '600' },
  changed: { color: colors.accent },
  state: { color: colors.dim, fontSize: 11, fontWeight: '700' },
  stateReversed: { color: colors.danger },
  flag: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  empty: { borderStyle: 'dashed', borderLeftWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  emptyText: { color: colors.dim, fontSize: 11 },
});

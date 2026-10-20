import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import type { Choice, Screen, Side, SlotView } from '../../session';
import { ActionTray } from '../components/ActionTray';
import { Button } from '../components/Button';
import { CardTile, EmptySlot } from '../components/CardTile';
import type { Overlay } from '../state/appReducer';
import { colors, font, minTouch, space } from '../theme';

interface Props {
  screen: Screen;
  selected: string | null;
  mulligan: readonly string[];
  mulliganChoice: Choice | null;
  notice: string | null;
  onChoose: (key: string) => void;
  onSelect: (card: string | null) => void;
  onToggleMulligan: (card: string) => void;
  onUndo: () => void;
  onOverlay: (o: Overlay) => void;
}

type ZoneKey = 'waiting' | 'clock' | 'level' | 'memory';

function Counts({ side, who, onZone }: { side: Side; who: 'you' | 'opponent'; onZone: (zone: ZoneKey) => void }) {
  const prefix = who === 'you' ? 'you' : 'opp';
  const zoneButton = (label: string, value: number, zone: ZoneKey) => (
    <Pressable key={zone} accessibilityRole="button" accessibilityLabel={`${label}: ${value} cards. Show them.`} onPress={() => onZone(zone)} testID={`${prefix}-${zone}`} style={({ pressed }) => [styles.zone, pressed && styles.pressed]}>
      <Text style={styles.zoneText}>
        {label} {value}
      </Text>
    </Pressable>
  );
  return (
    <View style={styles.counts}>
      <View style={styles.countsHead}>
        <Text style={styles.sideName} accessibilityRole="header">
          {side.name}
        </Text>
        <Text style={styles.countText}>
          Hand {side.handCount} · Deck {side.deckCount} · Stock {side.stockCount}
        </Text>
      </View>
      <View style={styles.chips}>
        {zoneButton('Level', side.levelCount, 'level')}
        {zoneButton('Clock', side.clockCount, 'clock')}
        {zoneButton('Waiting room', side.waitingCount, 'waiting')}
        {side.memoryCount > 0 ? zoneButton('Memory', side.memoryCount, 'memory') : null}
      </View>
    </View>
  );
}

function Row({ slots, prefix, width, groups, selected, onTap, onLong }: { slots: readonly SlotView[]; prefix: string; width: number; groups: ReadonlySet<string>; selected: string | null; onTap: (id: string, defId: string) => void; onLong: (defId: string) => void }) {
  return (
    <View style={styles.row}>
      {slots.map((s) =>
        s.card ? (
          <CardTile
            key={s.slot}
            tile={s.card}
            width={width}
            active={groups.has(s.card.id)}
            selected={selected === s.card.id}
            onPress={() => s.card && onTap(s.card.id, s.card.defId)}
            onLongPress={() => s.card && onLong(s.card.defId)}
            testID={`${prefix}-slot-${s.slot}`}
          />
        ) : (
          <EmptySlot key={s.slot} label={s.label} width={width} testID={`${prefix}-slot-${s.slot}`} />
        ),
      )}
    </View>
  );
}

/** The game board for the player holding the phone: the opponent above, you below, the decision at the bottom. */
export function BoardScreen({ screen, selected, mulligan, mulliganChoice, notice, onChoose, onSelect, onToggleMulligan, onUndo, onOverlay }: Props) {
  const { width } = useWindowDimensions();
  const slotWidth = Math.min(120, Math.floor((Math.min(width, 520) - space.l * 2 - space.s * 2) / 3));
  const prompt = screen.prompt;
  const groups = new Set(prompt?.layout === 'byCard' ? prompt.groups.map((g) => g.card.id) : []);
  const tap = (id: string, defId: string) => {
    if (prompt?.layout === 'byCard' && groups.has(id)) onSelect(selected === id ? null : id);
    else if (prompt?.layout === 'subset' && prompt.subset?.some((t) => t.id === id)) onToggleMulligan(id);
    else onOverlay({ kind: 'card', defId });
  };
  const card = (defId: string) => onOverlay({ kind: 'card', defId });
  const zone = (side: 'you' | 'opponent') => (z: ZoneKey) => onOverlay({ kind: 'zone', side, zone: z });
  const h = screen.header;
  const banner = [screen.attack, screen.resolving ? `${screen.resolving.name}: ${screen.resolving.text}` : null, screen.look ? (screen.look.cards ? `You are looking at ${screen.look.count} card${screen.look.count === 1 ? '' : 's'}.` : `${screen.look.who} is looking at ${screen.look.count} card${screen.look.count === 1 ? '' : 's'}.`) : null].filter(
    (x): x is string => x !== null,
  );
  const climaxes = [screen.opponent.climax ? { who: screen.opponent.name, tile: screen.opponent.climax } : null, screen.you.climax ? { who: 'Your', tile: screen.you.climax } : null].filter((x) => x !== null);
  return (
    <View style={styles.screen} testID="board-screen">
      <View style={styles.top}>
        <View style={styles.topText}>
          <Text style={styles.turn} testID="header-turn">
            {h.turn === 0 ? 'Setup' : `Turn ${h.turn} · ${h.yourTurn ? 'Your turn' : `${h.turnOf}’s turn`}`}
          </Text>
          <Text style={styles.phase}>{h.turn === 0 ? 'Opening hands' : h.step ? `${h.phase} · ${h.step}` : h.phase}</Text>
        </View>
        <View style={styles.topButton}>
          <Button label="Log" tone="quiet" onPress={() => onOverlay({ kind: 'log' })} testID="btn-log" />
        </View>
        <View style={styles.topButton}>
          <Button label="Menu" tone="quiet" onPress={() => onOverlay({ kind: 'menu' })} testID="btn-menu" />
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.body} testID="board-body">
        <Counts side={screen.opponent} who="opponent" onZone={zone('opponent')} />
        <Row slots={screen.opponent.back} prefix="opp" width={slotWidth} groups={groups} selected={selected} onTap={tap} onLong={card} />
        <Row slots={screen.opponent.front} prefix="opp" width={slotWidth} groups={groups} selected={selected} onTap={tap} onLong={card} />
        {banner.length > 0 || climaxes.length > 0 || screen.opponent.resolution.length + screen.you.resolution.length > 0 ? (
          <View style={styles.banner} testID="banner">
            {banner.map((b) => (
              <Text key={b} style={styles.bannerText}>
                {b}
              </Text>
            ))}
            {climaxes.map((c) => (
              <Text key={c.who} style={styles.bannerText} onPress={() => card(c.tile.defId)}>
                {c.who === 'Your' ? 'Your' : `${c.who}’s`} climax: {c.tile.name}
              </Text>
            ))}
            {[...screen.opponent.resolution, ...screen.you.resolution].length > 0 ? (
              <Text style={styles.bannerText}>Revealed: {[...screen.opponent.resolution, ...screen.you.resolution].map((t) => t.name).join(', ')}</Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.divider} />
        )}
        <Row slots={screen.you.front} prefix="you" width={slotWidth} groups={groups} selected={selected} onTap={tap} onLong={card} />
        <Row slots={screen.you.back} prefix="you" width={slotWidth} groups={groups} selected={selected} onTap={tap} onLong={card} />
        <Counts side={screen.you} who="you" onZone={zone('you')} />
        <Text style={styles.handTitle}>Your hand ({screen.you.handCount})</Text>
        <ScrollView horizontal contentContainerStyle={styles.hand} testID="hand">
          {(screen.you.hand ?? []).map((t, i) => (
            <CardTile
              key={t.id}
              tile={t}
              active={groups.has(t.id)}
              selected={selected === t.id}
              marked={mulligan.includes(t.id)}
              onPress={() => tap(t.id, t.defId)}
              onLongPress={() => card(t.defId)}
              testID={`hand-card-${i}`}
            />
          ))}
          {(screen.you.hand ?? []).length === 0 ? <Text style={styles.empty}>No cards</Text> : null}
        </ScrollView>
        {screen.recent.length > 0 ? (
          <View style={styles.recent} testID="recent">
            <Text style={styles.recentTitle}>Since your last move</Text>
            {screen.recent.slice(-6).map((l) => (
              <Text key={l.key} style={[styles.recentLine, l.kind === 'turn' && styles.recentTurn]}>
                {l.text}
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <ActionTray
        prompt={prompt}
        waiting={screen.waiting}
        canUndo={screen.canUndo}
        selected={selected}
        mulligan={mulligan}
        mulliganChoice={mulliganChoice}
        notice={notice}
        onChoose={onChoose}
        onSelect={onSelect}
        onToggleMulligan={onToggleMulligan}
        onUndo={onUndo}
        onCard={card}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.l, paddingVertical: space.s, borderBottomWidth: 1, borderColor: colors.line },
  topText: { flex: 1 },
  topButton: { width: 72 },
  turn: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  phase: { color: colors.dim, fontSize: font.small },
  body: { paddingHorizontal: space.l, paddingVertical: space.m, gap: space.s },
  counts: { gap: space.xs },
  sideName: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  countsHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.s, flexWrap: 'wrap' },
  countText: { color: colors.dim, fontSize: font.small },
  zone: { minHeight: minTouch, minWidth: minTouch, justifyContent: 'center', paddingHorizontal: space.m, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel },
  zoneText: { color: colors.text, fontSize: font.small, fontWeight: '600' },
  pressed: { opacity: 0.75 },
  row: { flexDirection: 'row', justifyContent: 'center', gap: space.s },
  banner: { backgroundColor: colors.panelHigh, borderRadius: 8, padding: space.s, gap: 2 },
  bannerText: { color: colors.text, fontSize: font.small },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: space.xs },
  handTitle: { color: colors.dim, fontSize: font.small, marginTop: space.xs },
  hand: { gap: space.s, paddingBottom: space.xs },
  empty: { color: colors.dim, fontSize: font.small },
  recent: { gap: 2, marginTop: space.xs },
  recentTitle: { color: colors.dim, fontSize: font.small, fontWeight: '700' },
  recentLine: { color: colors.dim, fontSize: font.small },
  recentTurn: { color: colors.text, fontWeight: '700' },
});

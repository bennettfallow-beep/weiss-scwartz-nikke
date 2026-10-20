import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Choice, ChoiceGroup, Prompt } from '../../session';
import { colors, font, space } from '../theme';
import { Button } from './Button';
import { CardTile } from './CardTile';

interface Props {
  prompt: Prompt | null;
  waiting: string | null;
  canUndo: boolean;
  selected: string | null;
  mulligan: readonly string[];
  /** The mulligan button for the cards marked so far. */
  mulliganChoice: Choice | null;
  notice: string | null;
  onChoose: (key: string) => void;
  onSelect: (card: string | null) => void;
  onToggleMulligan: (card: string) => void;
  onUndo: () => void;
  onCard: (defId: string) => void;
}

function ChoiceButtons({ choices, onChoose, start = 0 }: { choices: readonly Choice[]; onChoose: (key: string) => void; start?: number }) {
  return (
    <>
      {choices.map((c, i) => (
        <Button
          key={`${c.key}-${i}`}
          label={c.card && !c.label.includes(c.card.name) ? `${c.label}: ${c.card.name}` : c.label}
          detail={c.detail}
          tone={c.tone}
          onPress={() => onChoose(c.key)}
          testID={`choice-${start + i}`}
        />
      ))}
    </>
  );
}

function groupTitle(g: ChoiceGroup): string {
  const where = g.zone === 'hand' ? 'in your hand' : g.zone === 'climax' ? 'your climax' : 'on your stage';
  return `${g.card.name} (${where})`;
}

/** The decision in front of the player: words on top, buttons below, Undo when allowed. */
export function ActionTray({ prompt, waiting, canUndo, selected, mulligan, mulliganChoice, notice, onChoose, onSelect, onToggleMulligan, onUndo, onCard }: Props) {
  const group = prompt?.layout === 'byCard' ? (prompt.groups.find((g) => g.card.id === selected) ?? null) : null;
  return (
    <View style={styles.tray} testID="tray">
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        {notice ? (
          <Text style={styles.notice} accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : null}
        {prompt === null ? (
          <Text style={styles.waiting} testID="waiting" accessibilityLiveRegion="polite">
            {waiting ?? 'Waiting…'}
          </Text>
        ) : (
          <>
            <Text style={styles.title} testID="prompt-title" accessibilityRole="header">
              {prompt.title}
            </Text>
            <Text style={styles.text} testID="prompt-text">
              {prompt.text}
            </Text>
            {prompt.source && prompt.source.text ? <Text style={styles.source}>{prompt.source.text}</Text> : null}
            {prompt.picked.length > 0 ? <Text style={styles.source}>Chosen: {prompt.picked.join(', ')}</Text> : null}
            {prompt.layout === 'subset' ? (
              <>
                <ScrollView horizontal contentContainerStyle={styles.row}>
                  {(prompt.subset ?? []).map((t, i) => (
                    <CardTile key={t.id} tile={t} marked={mulligan.includes(t.id)} onPress={() => onToggleMulligan(t.id)} onLongPress={() => onCard(t.defId)} testID={`mulligan-card-${i}`} />
                  ))}
                </ScrollView>
                <Text style={styles.hint}>Tap cards to mark them to put back.</Text>
                <Button label={mulliganChoice?.label ?? 'Choose cards'} tone="primary" disabled={!mulliganChoice} onPress={() => mulliganChoice && onChoose(mulliganChoice.key)} testID="choice-0" />
              </>
            ) : null}
            {prompt.layout === 'list' ? <ChoiceButtons choices={prompt.choices} onChoose={onChoose} /> : null}
            {prompt.layout === 'byCard' && group ? (
              <>
                <Text style={styles.groupTitle}>{groupTitle(group)}</Text>
                <ChoiceButtons choices={group.choices} onChoose={onChoose} />
                <Button label="Back" tone="quiet" onPress={() => onSelect(null)} testID="group-back" />
              </>
            ) : null}
            {prompt.layout === 'byCard' && !group ? (
              <>
                <ChoiceButtons choices={prompt.choices} onChoose={onChoose} />
                {prompt.groups.length > 0 ? <Text style={styles.hint}>Cards you can use now (or tap a highlighted card):</Text> : null}
                {prompt.groups.map((g, i) => (
                  <Button key={g.card.id} label={groupTitle(g)} detail={`${g.choices.length} option${g.choices.length === 1 ? '' : 's'}`} onPress={() => onSelect(g.card.id)} testID={`group-${i}`} />
                ))}
              </>
            ) : null}
          </>
        )}
        {canUndo ? <Button label="Undo last step" tone="quiet" onPress={onUndo} testID="btn-undo" /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  tray: { maxHeight: '46%', borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.panel },
  inner: { padding: space.m, gap: space.s },
  title: { color: colors.accent, fontSize: font.title, fontWeight: '700' },
  text: { color: colors.text, fontSize: font.body },
  source: { color: colors.dim, fontSize: font.small },
  hint: { color: colors.dim, fontSize: font.small },
  groupTitle: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  waiting: { color: colors.dim, fontSize: font.body, paddingVertical: space.s },
  notice: { color: colors.danger, fontSize: font.small },
  row: { gap: space.s, paddingVertical: space.xs },
});

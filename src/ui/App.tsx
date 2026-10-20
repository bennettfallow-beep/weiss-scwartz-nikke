import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useReducer } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { cardDetail, gameOverScreen, handoffScreen, logFor, mulliganChoice, screenFor, starterCards } from '../session';
import type { Mode } from '../session';
import { useBackgroundCover } from './hooks/useBackgroundCover';
import { useBotTimer } from './hooks/useBotTimer';
import { useWebGuards } from './hooks/useWebGuards';
import { freshSeeds } from './platform/entropy';
import { BoardScreen } from './screens/BoardScreen';
import { CardSheet, ConcedeSheet, LogSheet, MenuSheet, ZoneSheet } from './screens/sheets';
import { GameOverScreen, HandoffScreen, HelpScreen, HomeScreen, NewGameScreen } from './screens/simple';
import { appReducer, initialState } from './state/appReducer';
import type { AppState, Overlay } from './state/appReducer';
import { colors, font, space } from './theme';

const ZONE_TITLES = { waiting: 'Waiting room', clock: 'Clock', level: 'Level zone', memory: 'Memory' } as const;

function init(): AppState {
  return initialState(starterCards().source);
}

function Root() {
  const [state, dispatch] = useReducer(appReducer, undefined, init);
  const { session, route, overlay } = state;
  const inGame = route.name === 'game' && session !== null;

  const botStep = useCallback(() => dispatch({ type: 'botStep' }), []);
  const background = useCallback(() => dispatch({ type: 'background' }), []);
  useBotTimer(inGame ? session : null, botStep);
  useBackgroundCover(background);

  const handoff = useMemo(() => (inGame && session ? handoffScreen(session) : null), [inGame, session]);
  const over = useMemo(() => (inGame && session ? gameOverScreen(session) : null), [inGame, session]);
  const screen = useMemo(() => (inGame && session && !handoff && !over ? screenFor(session) : null), [inGame, session, handoff, over]);
  const mulligan = useMemo(() => (session && screen?.prompt?.layout === 'subset' ? mulliganChoice(session, state.mulligan) : null), [session, screen, state.mulligan]);
  // Leaving the page loses a game in progress, also while How to play is open over it.
  const gameOn = useMemo(() => session !== null && gameOverScreen(session) === null, [session]);
  useWebGuards(gameOn);

  const start = (mode: Mode, decks: readonly [string, string]) => {
    let seeds: { gameSeed: string; botSeed: string };
    try {
      seeds = freshSeeds();
    } catch {
      dispatch({ type: 'notify', text: 'This device could not provide random numbers, so a fair game cannot start.' });
      return;
    }
    dispatch({ type: 'start', options: mode === 'computer' ? { mode, decks, seed: seeds.gameSeed, botSeed: seeds.botSeed } : { mode, decks, seed: seeds.gameSeed } });
  };
  const setOverlay = (o: Overlay) => dispatch({ type: 'overlay', overlay: o });
  const close = () => setOverlay(null);

  let content;
  if (route.name === 'home') content = <HomeScreen onMode={(mode) => dispatch({ type: 'navigate', route: { name: 'newGame', mode } })} onHelp={() => dispatch({ type: 'navigate', route: { name: 'help', back: 'home' } })} />;
  else if (route.name === 'newGame') content = <NewGameScreen mode={route.mode} onStart={(decks) => start(route.mode, decks)} onBack={() => dispatch({ type: 'navigate', route: { name: 'home' } })} />;
  else if (route.name === 'help') content = <HelpScreen onBack={() => dispatch({ type: 'navigate', route: route.back === 'game' && session ? { name: 'game' } : { name: 'home' } })} />;
  else if (!session) content = <Text style={styles.error}>No game in progress.</Text>;
  else if (handoff) content = <HandoffScreen model={handoff} onContinue={() => dispatch({ type: 'handoffDone' })} />;
  else if (over)
    content = (
      <GameOverScreen
        model={over}
        onRematch={() => state.last && start(state.last.mode, state.last.decks)}
        onNew={() => dispatch({ type: 'navigate', route: { name: 'newGame', mode: state.last?.mode ?? 'computer' } })}
        onHome={() => dispatch({ type: 'quit' })}
      />
    );
  else if (screen) {
    const zoneTiles = overlay?.kind === 'zone' ? (overlay.zone === 'level' ? screen[overlay.side].levelCards : screen[overlay.side][overlay.zone]) : [];
    const detail = overlay?.kind === 'card' ? cardDetail(session, overlay.defId) : null;
    content = (
      <View style={styles.fill}>
        <BoardScreen
          screen={screen}
          selected={state.selected}
          mulligan={state.mulligan}
          mulliganChoice={mulligan}
          notice={state.notice}
          onChoose={(key) => dispatch({ type: 'choose', key })}
          onSelect={(id) => dispatch({ type: 'select', id })}
          onToggleMulligan={(card) => dispatch({ type: 'toggleMulligan', card })}
          onUndo={() => dispatch({ type: 'undo' })}
          onOverlay={setOverlay}
        />
        {overlay?.kind === 'log' ? <LogSheet lines={logFor(session)} onClose={close} /> : null}
        {detail ? <CardSheet detail={detail} onClose={close} /> : null}
        {overlay?.kind === 'zone' ? <ZoneSheet title={`${overlay.side === 'you' ? 'Your' : `${screen.opponent.name}’s`} ${ZONE_TITLES[overlay.zone].toLowerCase()}`} tiles={zoneTiles} onCard={(defId) => setOverlay({ kind: 'card', defId })} onClose={close} /> : null}
        {overlay?.kind === 'menu' ? (
          <MenuSheet
            canConcede
            onHelp={() => dispatch({ type: 'navigate', route: { name: 'help', back: 'game' } })}
            onConcede={() => setOverlay({ kind: 'concede' })}
            onQuit={() => dispatch({ type: 'quit' })}
            onClose={close}
          />
        ) : null}
        {overlay?.kind === 'concede' ? <ConcedeSheet onConfirm={() => dispatch({ type: 'concede' })} onCancel={close} /> : null}
      </View>
    );
  } else content = <Text style={styles.error}>Something went wrong showing the game.</Text>;

  return (
    <SafeAreaView style={styles.fill} edges={['top', 'bottom', 'left', 'right']}>
      {state.notice && !screen ? (
        <Text style={styles.notice} testID="notice" onPress={() => dispatch({ type: 'dismissNotice' })}>
          {state.notice}
        </Text>
      ) : null}
      {content}
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider style={styles.root}>
      <Root />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1, backgroundColor: colors.bg },
  error: { color: colors.danger, fontSize: font.body, padding: space.l },
  notice: { color: colors.danger, fontSize: font.small, paddingHorizontal: space.l, paddingTop: space.s },
});

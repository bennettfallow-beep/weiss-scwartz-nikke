// In-app help: a short, original summary of how to play and how the app
// works. Plain words written for this app, not quotations of any rulebook.

export interface HelpSection {
  readonly title: string;
  readonly paragraphs: readonly string[];
}

export const HELP: readonly HelpSection[] = [
  {
    title: 'Goal',
    paragraphs: [
      'Each player starts at level 0. Every 7 points of damage in your clock raises your level by 1. A player who reaches level 4 loses.',
      'You also lose if your deck runs out and there is nothing in your waiting room to refresh it with.',
    ],
  },
  {
    title: 'A turn',
    paragraphs: [
      'Stand your characters, draw a card, then you may clock 1 card from your hand (put it into your clock) to draw 2 more.',
      'Main phase: play characters to your stage, play events and use abilities, paying their cost with stock.',
      'Climax phase: you may play 1 climax. Attack phase: you may attack with each standing character in your front row, one at a time. Then the turn ends.',
    ],
  },
  {
    title: 'Attacks',
    paragraphs: [
      'A front attack fights the character opposite: the lower power is reversed. A side attack has no battle, and its damage drops by the level of the character opposite (not at all against level 0). With nothing opposite, it is a direct attack with +1 damage.',
      'Each attack first checks the top card of your deck for trigger icons. In a front attack, the defender may then respond in the counter step.',
      'Damage reveals cards one at a time from the top of the deck. If a climax is revealed, that whole damage is canceled: the revealed cards go to the waiting room instead of the clock.',
    ],
  },
  {
    title: 'Playing on one phone',
    paragraphs: [
      'When it is the other player’s decision, the app shows a “Pass the phone” screen with no cards on it. Only press the button on it once the right player holds the phone.',
      'This includes the counter step: the defending player is always asked, even when they have nothing to play, so the question itself gives nothing away.',
      'If the app goes to the background, it asks for the phone to be handed over again before showing any cards.',
    ],
  },
  {
    title: 'Using the app',
    paragraphs: [
      'The panel at the bottom always says what you are deciding. In the main phase, tap a highlighted card to see what it can do. Long-press any card to read it in full.',
      'Undo is offered only while your last step revealed nothing new and it is still your decision.',
      'The computer player sees only what a player in its seat could see.',
      'This version plays the built-in starter decks. Loading your own cards, saving a game and card pictures are coming next. Reloading the page ends the current game.',
    ],
  },
];

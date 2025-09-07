
export interface Student {
  name: string;
  absent: boolean;
}

export type Topic = string;

export interface Team {
  id: number;
  name: string;
  score: number;
}

export type GameMode = 'single' | 'team';

export interface HangmanState {
  teams: Team[];
  currentTeamIndex: number;
  selectedWord: string;
  correctLetters: string[];
  wrongLetters: string[];
  isRoundOver: boolean;
  wordList: string[];
  currentWordIndex: number;
}

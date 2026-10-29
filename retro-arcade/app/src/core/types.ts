import type { ComponentType } from 'react';

export interface GameProps {
  onExit: () => void;
}

export interface GameModule {
  id: string;
  title: string;
  Icon: ComponentType<{ size: number }>;
  /** Missing until the game is built; the home screen shows the icon as "soon". */
  Component?: ComponentType<GameProps>;
}

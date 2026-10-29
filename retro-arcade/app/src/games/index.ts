import type { GameModule } from '../core/types';
import { DashIcon, FlappyIcon, HopIcon, MergeIcon, StackIcon } from '../ui/icons';
import Flappy from './flappy/Flappy';
import LaneDash from './dash/LaneDash';
import Hop from './hop/Hop';

export const games: GameModule[] = [
  { id: 'flappy', title: 'Flappy Wing', Icon: FlappyIcon, Component: Flappy },
  { id: 'hop', title: 'Hop Hop', Icon: HopIcon, Component: Hop },
  { id: 'dash', title: 'Lane Dash', Icon: DashIcon, Component: LaneDash },
  { id: 'stack', title: 'Tower Stack', Icon: StackIcon },
  { id: 'merge', title: 'Merge 16', Icon: MergeIcon },
];

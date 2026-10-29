import type { GameModule } from '../core/types';
import { DashIcon, FlappyIcon, HopIcon, MergeIcon, StackIcon } from '../ui/icons';
import Flappy from './flappy/Flappy';
import LaneDash from './dash/LaneDash';
import Hop from './hop/Hop';
import Merge16 from './merge/Merge16';
import TowerStack from './stack/TowerStack';

export const games: GameModule[] = [
  { id: 'flappy', title: 'Flappy Wing', Icon: FlappyIcon, Component: Flappy },
  { id: 'hop', title: 'Hop Hop', Icon: HopIcon, Component: Hop },
  { id: 'dash', title: 'Lane Dash', Icon: DashIcon, Component: LaneDash },
  { id: 'stack', title: 'Tower Stack', Icon: StackIcon, Component: TowerStack },
  { id: 'merge', title: 'Merge 16', Icon: MergeIcon, Component: Merge16 },
];

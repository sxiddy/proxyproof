import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';

export interface Config {
  jwtSecret: string;
  /** Anyone signing up as an organiser needs this staff code. */
  organiserCode: string;
}

export interface Ctx {
  db: Db;
  config: Config;
  rt: Realtime;
}

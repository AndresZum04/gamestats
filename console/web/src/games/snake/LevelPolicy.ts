/**
 * Levels of the plan: a new level every 5 fruits; the tick starts at 150 ms
 * and goes down 10 ms per level down to 60 ms; obstacles from level 3.
 */
export class LevelPolicy {
  readonly fruitsPerLevel = 5;
  readonly baseTickMs = 150;
  readonly tickStepMs = 10;
  readonly minTickMs = 60;
  readonly obstaclesFromLevel = 3;
  readonly obstaclesPerLevel = 4;
  readonly maxObstacles = 24;

  /** Level after eating `fruits` fruits in the match (lives do not reset it). */
  levelFor(fruits: number): number {
    return 1 + Math.floor(fruits / this.fruitsPerLevel);
  }

  tickMs(level: number): number {
    return Math.max(this.minTickMs, this.baseTickMs - this.tickStepMs * (level - 1));
  }

  /** `speed` of LEVEL_UP: how many times faster than level 1, with two decimals. */
  speed(level: number): number {
    return Math.round((this.baseTickMs / this.tickMs(level)) * 100) / 100;
  }

  /** Obstacles on the board at this level: 0 before level 3, then 4 more per level. */
  obstacles(level: number): number {
    if (level < this.obstaclesFromLevel) return 0;
    const count = (level - this.obstaclesFromLevel + 1) * this.obstaclesPerLevel;
    return Math.min(this.maxObstacles, count);
  }
}

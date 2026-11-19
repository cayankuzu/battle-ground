export interface SpatialEntry {
  id: number;
  x: number;
  z: number;
}

export class SpatialGrid<T extends SpatialEntry> {
  private readonly cellSize: number;
  private readonly cells = new Map<number, T[]>();

  constructor(cellSize = 4.0) {
    this.cellSize = cellSize;
  }

  private hash(cx: number, cz: number): number {
    return ((cx + 2048) << 12) ^ (cz + 2048);
  }

  public clear(): void {
    this.cells.clear();
  }

  public insert(item: T): void {
    const cx = Math.floor(item.x / this.cellSize);
    const cz = Math.floor(item.z / this.cellSize);
    const key = this.hash(cx, cz);
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    bucket.push(item);
  }

  public queryRadius(x: number, z: number, radius: number, out: T[]): T[] {
    out.length = 0;
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minZ = Math.floor((z - radius) / this.cellSize);
    const maxZ = Math.floor((z + radius) / this.cellSize);
    const r2 = radius * radius;

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const bucket = this.cells.get(this.hash(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const item = bucket[i];
          const dx = item.x - x;
          const dz = item.z - z;
          if (dx * dx + dz * dz <= r2) {
            out.push(item);
          }
        }
      }
    }
    return out;
  }
}

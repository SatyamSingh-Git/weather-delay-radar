import { readFile, rename, writeFile } from 'node:fs/promises';
import type { Order, ProcessedOrder } from '../types';

export async function readOrders(path: string): Promise<Order[]> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));

  if (!Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON array of orders`);
  }
  for (const order of parsed) {
    if (typeof order?.order_id !== 'string' || typeof order?.city !== 'string') {
      throw new Error(`${path} contains an order without a string order_id and city`);
    }
  }
  return parsed as Order[];
}

/** Temp file then rename, so a crash mid-write cannot truncate the deliverable. */
export async function writeOrders(path: string, orders: ProcessedOrder[]): Promise<void> {
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(orders, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

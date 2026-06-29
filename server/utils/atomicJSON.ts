import fs from 'fs';
import path from 'path';

const lockMap = new Map<string, Promise<void>>();

async function acquireLock(filePath: string): Promise<() => void> {
    while (lockMap.has(filePath)) {
        await lockMap.get(filePath);
    }
    let release: () => void;
    const lockPromise = new Promise<void>((resolve) => { release = resolve; });
    lockMap.set(filePath, lockPromise);
    return () => {
        lockMap.delete(filePath);
        release!();
    };
}

export async function atomicReadJSON<T>(filePath: string): Promise<T> {
    const release = await acquireLock(filePath);
    try {
        if (!fs.existsSync(filePath)) return [] as unknown as T;
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error(`Failed to read ${filePath}:`, e);
        return [] as unknown as T;
    } finally {
        release();
    }
}

export async function atomicWriteJSON(filePath: string, data: any): Promise<boolean> {
    const release = await acquireLock(filePath);
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const tmpPath = filePath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmpPath, filePath); // Atomic on POSIX
        return true;
    } catch (e) {
        console.error(`Failed to write ${filePath}:`, e);
        return false;
    } finally {
        release();
    }
}

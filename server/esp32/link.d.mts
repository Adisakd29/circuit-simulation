export interface Esp32Paths { bridge: string; lib: string; bios: string; flash: string; icount?: string }
export interface Esp32Link { send(line: string): void; readLine(): string; close(): void }
export function esp32PathsFromEnv(env?: Record<string, string | undefined>): Esp32Paths | null;
export function openEsp32Link(p: Esp32Paths): Esp32Link;

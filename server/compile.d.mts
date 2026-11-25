export interface Diagnostic { file: string; line: number; col: number; severity: 'error' | 'warning' | 'note'; message: string }
export interface CompileResult { ok: boolean; hex?: string; size?: { flash: number; ram: number; maxFlash: number; maxRam: number }; diagnostics: Diagnostic[]; log: string }
export const CORE_DIR: string;
export const SERVO_DIR: string;
export const MAX_SOURCE: number;
export const BOARDS: Record<string, { name: string; mcu: string; fcpu: string; board: string; variant: string; maxFlash: number; maxRam: number; defines?: string[] }>;
export const UNOQ_UNSUPPORTED: Array<[RegExp, string]>;
export function prebuild(boardId?: string): Promise<string>;
export function findFunctions(src: string): { protos: string[]; firstLine: number };
export function preprocessSketch(src: string): { cpp: string; protos: string[] };
export function checkSource(src: string): Array<{ line: number; col: number; severity: string; message: string }>;
export function parseDiagnostics(text: string): Diagnostic[];
export function compileSketch(src: string, boardId?: string): Promise<CompileResult>;
export function toolchainInfo(): Promise<{ avrGcc: string; core: string; servo: string; boards: string[] }>;
export function toolchainReady(): Promise<boolean>;

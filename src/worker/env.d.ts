/* Tipos mínimos do runtime Cloudflare usados pelo Worker. O wrangler faz o bundle com esbuild sem
   verificação de tipos; isto serve o editor e o `astro check`, sem acrescentar dependências. */
declare module 'cloudflare:workers' {
	export class DurableObject {
		constructor(ctx: DurableObjectState, env: unknown);
		protected ctx: DurableObjectState;
		protected env: unknown;
		fetch(request: Request): Promise<Response>;
	}
}

interface SqlRow { [k: string]: unknown }
interface SqlCursor { toArray(): SqlRow[]; one(): SqlRow; }
interface SqlStorage { exec(query: string, ...bindings: unknown[]): SqlCursor; }
interface DurableObjectStorage {
	get<T = unknown>(key: string): Promise<T | undefined>;
	put<T = unknown>(key: string, value: T): Promise<void>;
	sql: SqlStorage;
}
interface DurableObjectState { storage: DurableObjectStorage; }
interface DurableObjectId { toString(): string; }
interface DurableObjectStub { fetch(input: string | Request, init?: RequestInit): Promise<Response>; }
interface DurableObjectNamespace { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): DurableObjectStub; }
interface ExecutionContext { waitUntil(p: Promise<unknown>): void; passThroughOnException(): void; }
interface Response { json<T = unknown>(): Promise<T>; }

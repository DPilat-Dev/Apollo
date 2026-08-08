import type { IncomingMessage, ServerResponse } from 'node:http'

export interface ApolloRuntimeConfig {
  jellyseerrTarget: string
}

export function readConfig(): Promise<ApolloRuntimeConfig>
export function writeConfig(next: Partial<ApolloRuntimeConfig>): Promise<ApolloRuntimeConfig>
export function normalizeTarget(value: unknown): string | null
export function isJellyfinAdmin(args: { server?: string; token?: string }): Promise<boolean>
export function handleConfigRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean>
export function proxyJellyseerr(req: IncomingMessage, res: ServerResponse): Promise<boolean>

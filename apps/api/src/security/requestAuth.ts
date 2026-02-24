import type { FastifyRequest } from "fastify";

export type RequestAuthType = "owner_session" | "capability_token" | "legacy_header";

export interface RequestAuthContext {
  auth_type: RequestAuthType;
  workspace_id: string;
  principal_id: string;
  principal_type: "user" | "agent" | "service";
  owner_id?: string;
  session_id?: string;
  token_id?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: RequestAuthContext;
  }
}

export function setRequestAuth(req: FastifyRequest, auth: RequestAuthContext): void {
  req.auth = auth;
}

export function getRequestAuth(req: FastifyRequest): RequestAuthContext {
  if (!req.auth) throw new Error("request_auth_missing");
  return req.auth;
}

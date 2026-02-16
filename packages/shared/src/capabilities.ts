export interface CapabilityScopesV1 {
  rooms?: string[];
  tools?: string[];
  egress_domains?: string[];
  action_types?: string[];
  data_access?: {
    read?: string[];
    write?: string[];
  };
}

export interface CapabilityTokenV1 {
  token_id: string;
  workspace_id: string;

  issued_to_principal_id: string;
  granted_by_principal_id: string;

  parent_token_id?: string;
  scopes: CapabilityScopesV1;

  valid_until?: string;
  revoked_at?: string;
  created_at: string;
}


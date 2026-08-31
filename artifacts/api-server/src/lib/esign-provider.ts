export type ESignRequest = {
  requestId: string;
  status: "pending" | "signed" | "cancelled";
};

export type ESignEvidence = {
  provider: string;
  requestId: string;
  evidenceAvailable: boolean;
};

export interface ESignProvider {
  createSigningRequest(input: {
    saleId: string;
    revisionId: string;
    signerEmail: string | null;
  }): Promise<ESignRequest>;
  getSigningStatus(requestId: string): Promise<ESignRequest>;
  cancelSigningRequest(requestId: string): Promise<void>;
  downloadSignedPack(requestId: string): Promise<Buffer | null>;
  verifyWebhook(payload: string, signature: string | undefined): boolean;
  getAuditEvidence(requestId: string): Promise<ESignEvidence>;
}

/**
 * The development provider deliberately has no external credentials or network
 * calls. It preserves the seam a production provider will implement later.
 */
export class DemoESignProvider implements ESignProvider {
  async createSigningRequest(input: {
    saleId: string;
    revisionId: string;
    signerEmail: string | null;
  }): Promise<ESignRequest> {
    return {
      requestId: `demo-${input.saleId}-${input.revisionId}`,
      status: "pending",
    };
  }

  async getSigningStatus(requestId: string): Promise<ESignRequest> {
    return { requestId, status: "pending" };
  }

  async cancelSigningRequest(_requestId: string): Promise<void> {}

  async downloadSignedPack(_requestId: string): Promise<Buffer | null> {
    return null;
  }

  verifyWebhook(_payload: string, _signature: string | undefined): boolean {
    return false;
  }

  async getAuditEvidence(requestId: string): Promise<ESignEvidence> {
    return { provider: "demo", requestId, evidenceAvailable: false };
  }
}

export const demoESignProvider = new DemoESignProvider();
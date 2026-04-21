/**
 * Ambient module declaration per `nordigen-node`.
 *
 * Il pacchetto include dei tipi in `dist/types/` ma il suo `package.json#exports`
 * non li espone, quindi `tsc` con `moduleResolution: "bundler"` non riesce a
 * risolverli. Dichiariamo qui lo shape minimo usato dall'applicazione.
 */
declare module "nordigen-node" {
  export interface NordigenInstitutionApi {
    getInstitutions(params: { country: string }): Promise<unknown>;
    getInstitutionById(id: string): Promise<unknown>;
  }

  export interface NordigenRequisitionApi {
    createRequisition(params: {
      redirectUrl: string;
      institutionId: string;
      agreement?: string;
      userLanguage?: string;
      reference?: string;
      ssn?: string;
      redirectImmediate?: boolean;
      accountSelection?: boolean;
    }): Promise<unknown>;
    getRequisitions(params?: {
      limit?: number;
      offset?: number;
    }): Promise<unknown>;
    getRequisitionById(requisitionId: string): Promise<unknown>;
    deleteRequisition(requisitionId: string): Promise<unknown>;
  }

  export interface NordigenAgreementApi {
    createAgreement(params: {
      institutionId: string;
      maxHistoricalDays?: number;
      accessValidForDays?: number;
      accessScope?: string[];
    }): Promise<unknown>;
    getAgreementById(agreementId: string): Promise<unknown>;
  }

  export interface NordigenAccountApi {
    getMetadata(): Promise<unknown>;
    getDetails(): Promise<unknown>;
    getBalances(): Promise<unknown>;
    getTransactions(params?: {
      dateFrom?: string;
      dateTo?: string;
      country?: string;
    }): Promise<unknown>;
  }

  export default class NordigenClient {
    constructor(params: {
      secretId: string;
      secretKey: string;
      baseUrl?: string;
    });
    institution: NordigenInstitutionApi;
    requisition: NordigenRequisitionApi;
    agreement: NordigenAgreementApi;
    token: string;
    account(accountId: string): NordigenAccountApi;
    generateToken(): Promise<{
      access: string;
      access_expires: number;
      refresh: string;
      refresh_expires: number;
    }>;
    exchangeToken(params: { refreshToken: string }): Promise<unknown>;
    initSession(params: {
      redirectUrl: string;
      institutionId: string;
      referenceId?: string;
      maxHistoricalDays?: number;
      accessValidForDays?: number;
      userLanguage?: string;
      ssn?: string;
      redirectImmediate?: boolean;
      accountSelection?: boolean;
    }): Promise<{ link: string; id: string; accounts?: string[] }>;
  }
}

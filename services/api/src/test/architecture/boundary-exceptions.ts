export interface BoundaryException {
  importer: string;
  imported: string;
  reason: string;
}

export const boundaryExceptions: BoundaryException[] = [];

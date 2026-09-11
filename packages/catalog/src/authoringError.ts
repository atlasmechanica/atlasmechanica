export class CatalogAuthoringError extends TypeError {
  constructor(readonly source: string, readonly pointer: string, message: string) {
    super(`${source}${pointer === '' ? '' : `#${pointer}`}: ${message}`);
    this.name = 'CatalogAuthoringError';
  }
}

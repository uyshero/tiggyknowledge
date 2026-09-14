import { Context, Service } from '@deepseek-ai/cordis';
declare module '@deepseek-ai/cordis' {
    interface Context {
        knowledgeContent: ContentLocal;
    }
}
export interface Config {
    dataDir: string;
}
export interface StoredAsset {
    id: string;
    contentHash: string;
    sizeBytes: number;
}
export declare class ContentLocal extends Service {
    private readonly assetRoot;
    constructor(ctx: Context, config: Config);
    save(bytes: Uint8Array): StoredAsset;
    read(id: string): Uint8Array;
}
export default ContentLocal;
//# sourceMappingURL=index.d.ts.map
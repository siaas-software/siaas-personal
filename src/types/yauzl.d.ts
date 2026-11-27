declare module "yauzl" {
  interface Entry {
    fileName: string;
    externalFileAttributes: number;
    generalPurposeBitFlag: number;
    compressionMethod: number;
    uncompressedSize: number;
    crc32: number;
  }
  export function fromBufferPromise(bytes: Buffer, options: {
    lazyEntries: true; strictFileNames: true; validateEntrySizes: true;
  }): Promise<{
    entryCount: number;
    eachEntry(): AsyncIterable<Entry>;
    openReadStreamPromise(entry: Entry): Promise<import("node:stream").Readable>;
    close(): void;
  }>;
}

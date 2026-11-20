/** The Electron APIs already supplied by desktop Obsidian. */
declare namespace AniLinkDesktop {
  interface Cookie { name: string; value: string; domain?: string; path?: string }
  interface Session {
    fetch(input: string, init?: RequestInit): Promise<Response>;
    cookies: {
      get(filter: { url?: string; domain?: string }): Promise<Cookie[]>;
      remove(url: string, name: string): Promise<void>;
      flushStore(): Promise<void>;
    };
  }
  interface Electron {
    shell: {
      openExternal(url: string): Promise<void>;
      openPath(path: string): Promise<string>;
    };
    remote: {
      clipboard: { readText(): string };
      dialog: { showOpenDialog(options: { properties: string[]; filters?: { name: string; extensions: string[] }[] }): Promise<{ canceled: boolean; filePaths: string[] }> };
      session: { defaultSession: Session; fromPartition(partition: string): Session };
      getCurrentWebContents(): { getUserAgent(): string };
    };
  }
}

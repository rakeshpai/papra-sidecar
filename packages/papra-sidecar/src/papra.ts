import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

export interface PapraDocument {
  id: string;
  name?: string;
  content?: string;
  [key: string]: unknown;
}

export interface PapraTag {
  id: string;
  name: string;
  [key: string]: unknown;
}

async function parseJson<T>(response: Response, context: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`papra ${context} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export class PapraClient {
  private readonly apiUrl: string;

  constructor(
    private readonly apiToken: string,
    private readonly organizationId: string,
    apiUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.apiUrl = apiUrl.replace(/\/+$/, '');
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    return this.fetchImpl(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${this.apiToken}`,
      },
    });
  }

  async createDocument(filePath: string): Promise<PapraDocument> {
    const form = new FormData();
    form.set(
      'file',
      new File([readFileSync(filePath)], basename(filePath), { type: 'application/pdf' }),
    );
    const data = await parseJson<{ document: PapraDocument }>(
      await this.request(`/api/organizations/${this.organizationId}/documents`, {
        method: 'POST',
        body: form,
      }),
      'createDocument',
    );
    return data.document;
  }

  async getDocument(documentId: string): Promise<PapraDocument> {
    const data = await parseJson<{ document: PapraDocument }>(
      await this.request(`/api/organizations/${this.organizationId}/documents/${documentId}`),
      'getDocument',
    );
    return data.document;
  }

  async waitForExtraction(
    documentId: string,
    timeoutMs: number,
    intervalMs = 3000,
  ): Promise<PapraDocument> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const document = await this.getDocument(documentId);
      if ((document.content ?? '').trim().length > 0) {
        return document;
      }
      await sleep(intervalMs);
    }
    throw new Error(`papra content extraction did not complete within ${timeoutMs}ms`);
  }

  async patchDocument(
    documentId: string,
    patch: { name?: string; content?: string },
  ): Promise<PapraDocument> {
    const data = await parseJson<{ document: PapraDocument }>(
      await this.request(`/api/organizations/${this.organizationId}/documents/${documentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
      'patchDocument',
    );
    return data.document;
  }

  async listTags(): Promise<PapraTag[]> {
    const data = await parseJson<{ tags: PapraTag[] }>(
      await this.request(`/api/organizations/${this.organizationId}/tags`),
      'listTags',
    );
    return data.tags;
  }

  async createTag(name: string, color: string): Promise<PapraTag> {
    const form = new FormData();
    form.set('name', name);
    form.set('color', color);
    const data = await parseJson<{ tag: PapraTag }>(
      await this.request(`/api/organizations/${this.organizationId}/tags`, {
        method: 'POST',
        body: form,
      }),
      'createTag',
    );
    return data.tag;
  }

  async addTagToDocument(documentId: string, tagId: string): Promise<void> {
    const response = await this.request(
      `/api/organizations/${this.organizationId}/documents/${documentId}/tags`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId }),
      },
    );
    if (!response.ok) {
      throw new Error(`papra addTagToDocument failed: ${response.status} ${await response.text()}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
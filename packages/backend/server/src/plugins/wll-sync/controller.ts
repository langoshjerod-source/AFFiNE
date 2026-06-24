import { timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { DocReader, DocWriter } from '../../core/doc';
import { PermissionAccess } from '../../core/permission';

type WllSyncUpsertMarkdownBody = {
  workspaceId?: string;
  docId?: string | null;
  title?: string;
  markdown?: string;
  editorUserId?: string;
};

type WllSyncUpsertMarkdownPayload = {
  workspaceId: string;
  docId: string | null;
  title: string;
  markdown: string;
  editorUserId: string;
};

type WllSyncUpsertMarkdownResponse = {
  ok: true;
  docId: string;
  action: 'created' | 'updated';
};

type WllSyncReadMarkdownBody = {
  workspaceId?: string;
  docId?: string;
  editorUserId?: string;
  aiEditable?: boolean;
};

type WllSyncReadMarkdownPayload = {
  workspaceId: string;
  docId: string;
  editorUserId: string;
  aiEditable: boolean;
};

type WllSyncReadMarkdownResponse = {
  ok: true;
  docId: string;
  title: string;
  markdown: string;
  knownUnsupportedBlocks: string[];
  unknownBlocks: string[];
};

@Controller('/api/wll-sync')
export class WllSyncController {
  constructor(
    private readonly writer: DocWriter,
    private readonly reader: DocReader,
    private readonly ac: PermissionAccess
  ) {}

  @Get('/healthz')
  healthz(@Headers('x-wll-sync-token') token: string | undefined) {
    this.assertToken(token);
    return { ok: true };
  }

  @Post('/docs/upsert-markdown')
  async upsertMarkdown(
    @Headers('x-wll-sync-token') token: string | undefined,
    @Body() body: WllSyncUpsertMarkdownBody
  ): Promise<WllSyncUpsertMarkdownResponse> {
    this.assertToken(token);
    const payload = this.normalizePayload(body);

    if (payload.docId) {
      await this.assertCanUpdate(payload);
      await this.writer.updateDoc(
        payload.workspaceId,
        payload.docId,
        payload.markdown,
        payload.editorUserId
      );
      await this.writer.updateDocMeta(
        payload.workspaceId,
        payload.docId,
        { title: payload.title },
        payload.editorUserId
      );
      return { ok: true, docId: payload.docId, action: 'updated' };
    }

    await this.assertCanCreate(payload);
    const result = await this.writer.createDoc(
      payload.workspaceId,
      payload.title,
      payload.markdown,
      payload.editorUserId
    );
    return { ok: true, docId: result.docId, action: 'created' };
  }

  @Post('/docs/read-markdown')
  async readMarkdown(
    @Headers('x-wll-sync-token') token: string | undefined,
    @Body() body: WllSyncReadMarkdownBody
  ): Promise<WllSyncReadMarkdownResponse> {
    this.assertToken(token);
    const payload = this.normalizeReadPayload(body);
    await this.assertCanRead(payload);

    const result = await this.reader.getDocMarkdown(
      payload.workspaceId,
      payload.docId,
      payload.aiEditable
    );
    if (!result) {
      throw new NotFoundException('doc not found');
    }

    return { ok: true, docId: payload.docId, ...result };
  }

  private assertToken(token: string | undefined) {
    const expected = process.env.WLL_SYNC_TOKEN;
    if (!expected || !token || !safeEqual(token, expected)) {
      throw new UnauthorizedException('invalid WLL sync token');
    }
  }

  private normalizePayload(
    body: WllSyncUpsertMarkdownBody
  ): WllSyncUpsertMarkdownPayload {
    const workspaceId = body.workspaceId?.trim();
    const docId = body.docId?.trim() || null;
    const title = body.title?.trim();
    const markdown = body.markdown;
    const editorUserId = body.editorUserId?.trim();

    if (!workspaceId) throw new BadRequestException('workspaceId is required');
    if (!title) throw new BadRequestException('title is required');
    if (title.length > 512) {
      throw new BadRequestException('title must be 512 characters or fewer');
    }
    if (markdown === undefined || markdown === null) {
      throw new BadRequestException('markdown is required');
    }
    if (!editorUserId) {
      throw new BadRequestException('editorUserId is required');
    }

    return { workspaceId, docId, title, markdown, editorUserId };
  }

  private normalizeReadPayload(
    body: WllSyncReadMarkdownBody
  ): WllSyncReadMarkdownPayload {
    const workspaceId = body.workspaceId?.trim();
    const docId = body.docId?.trim();
    const editorUserId = body.editorUserId?.trim();

    if (!workspaceId) throw new BadRequestException('workspaceId is required');
    if (!docId) throw new BadRequestException('docId is required');
    if (!editorUserId) {
      throw new BadRequestException('editorUserId is required');
    }

    return {
      workspaceId,
      docId,
      editorUserId,
      aiEditable: body.aiEditable ?? true,
    };
  }

  private async assertCanCreate(payload: WllSyncUpsertMarkdownPayload) {
    const canCreate = await this.ac
      .user(payload.editorUserId)
      .workspace(payload.workspaceId)
      .can('Workspace.CreateDoc');
    if (!canCreate) {
      throw new ForbiddenException(
        'editor user cannot create docs in workspace'
      );
    }
  }

  private async assertCanUpdate(payload: WllSyncUpsertMarkdownPayload) {
    if (!payload.docId) {
      throw new BadRequestException('docId is required');
    }
    const canUpdate = await this.ac
      .user(payload.editorUserId)
      .doc(payload.workspaceId, payload.docId)
      .can('Doc.Update');
    if (!canUpdate) {
      throw new ForbiddenException('editor user cannot update doc');
    }
  }

  private async assertCanRead(payload: WllSyncReadMarkdownPayload) {
    const canRead = await this.ac
      .user(payload.editorUserId)
      .doc(payload.workspaceId, payload.docId)
      .can('Doc.Read');
    if (!canRead) {
      throw new ForbiddenException('editor user cannot read doc');
    }
  }
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

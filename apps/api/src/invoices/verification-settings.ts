import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { EmployeeView, SaveVerificationSetting, VerificationSettingView } from '@frs/contracts';
import { DomainError } from '@frs/domain';
import { PrismaService } from '../prisma.service';
import { draftVerificationSetting } from './verification-setting-draft';
import { sealSecret, secretHint } from './verification-secret';

@Injectable()
export class VerificationSettingsCommands {
  constructor(private readonly prisma: PrismaService) {}

  async get(actor: EmployeeView): Promise<VerificationSettingView> {
    this.assertFinance(actor);
    const row = await this.prisma.verificationSetting.findUnique({ where: { companyId: actor.company.id } });
    return toView(row);
  }

  async save(actor: EmployeeView, input: SaveVerificationSetting): Promise<VerificationSettingView> {
    this.assertFinance(actor);
    const existing = await this.prisma.verificationSetting.findUnique({ where: { companyId: actor.company.id } });
    const draft = draftVerificationSetting(
      existing
        ? {
            provider: existing.provider,
            baseUrl: existing.baseUrl,
            model: existing.model,
            region: existing.region,
            secretId: existing.secretId,
            apiKey: existing.apiKey,
          }
        : null,
      input,
      sealSecret,
    );
    const saved = await this.prisma.verificationSetting.upsert({
      where: { companyId: actor.company.id },
      create: {
        id: uuidv7(),
        tenantId: 'default',
        companyId: actor.company.id,
        ...draft,
        updatedBy: actor.id,
      },
      update: { ...draft, updatedBy: actor.id },
    });
    return toView(saved);
  }

  private assertFinance(actor: EmployeeView): void {
    if (actor.role !== 'finance') {
      throw new DomainError('ACTOR_FORBIDDEN', '只有财务可以配置查验');
    }
  }
}

function toView(row: {
  provider: string;
  baseUrl: string;
  model: string;
  region: string;
  secretId: string;
  apiKey: string;
} | null): VerificationSettingView {
  const provider = row?.provider === 'tencent' || row?.provider === 'custom' ? row.provider : 'off';
  return {
    provider,
    baseUrl: row?.baseUrl ?? '',
    model: row?.model ?? '',
    region: row?.region || 'ap-guangzhou',
    secretId: row?.secretId ?? '',
    apiKeySet: Boolean(row?.apiKey),
    apiKeyHint: row?.apiKey ? secretHint(row.apiKey) : '',
  };
}

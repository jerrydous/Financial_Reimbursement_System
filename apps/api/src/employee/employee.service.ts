import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  assertCanBindSubject,
  assertSameSubject,
  IdentityError,
  type AccessTokenClaims,
} from '@frs/domain';
import type { EmployeeView } from '@frs/contracts';
import { PrismaService } from '../prisma.service';

const employeeInclude = { company: true } as const;

type EmployeeRecord = {
  id: string;
  username: string;
  name: string;
  email: string;
  keycloakSubject: string | null;
  company: { id: string; name: string; taxId: string };
};

@Injectable()
export class EmployeeService {
  constructor(private readonly prisma: PrismaService) {}

  async getOwn(claims: AccessTokenClaims): Promise<EmployeeView> {
    const existing = await this.prisma.employee.findUnique({
      where: { keycloakSubject: claims.subject },
      include: employeeInclude,
    });
    if (existing) {
      try {
        assertSameSubject(claims.subject, existing.keycloakSubject ?? '');
      } catch (error) {
        throw asForbidden(error);
      }
      return toView(existing);
    }

    const byUsername = await this.prisma.employee.findUnique({
      where: { username: claims.username },
      include: employeeInclude,
    });
    if (!byUsername) {
      throw new ForbiddenException({
        code: 'EMPLOYEE_NOT_FOUND',
        message: '当前账号没有员工身份',
      });
    }
    try {
      assertCanBindSubject(byUsername.keycloakSubject, claims.subject);
    } catch (error) {
      throw asForbidden(error);
    }
    const claimed = await this.prisma.employee.updateMany({
      where: { id: byUsername.id, keycloakSubject: null },
      data: { keycloakSubject: claims.subject },
    });
    const current = await this.prisma.employee.findUniqueOrThrow({
      where: { id: byUsername.id },
      include: employeeInclude,
    });
    if (claimed.count === 0) {
      try {
        assertCanBindSubject(current.keycloakSubject, claims.subject);
        assertSameSubject(claims.subject, current.keycloakSubject ?? '');
      } catch (error) {
        throw asForbidden(error);
      }
    }
    return toView(current);
  }
}

function asForbidden(error: unknown): unknown {
  if (error instanceof IdentityError) {
    return new ForbiddenException({
      code: error.code,
      message: '当前登录与员工身份不一致',
    });
  }
  return error;
}

function toView(employee: EmployeeRecord): EmployeeView {
  return {
    id: employee.id,
    username: employee.username,
    name: employee.name,
    email: employee.email,
    company: {
      id: employee.company.id,
      name: employee.company.name,
      taxId: employee.company.taxId,
    },
  };
}

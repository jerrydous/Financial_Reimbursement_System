// 制度判断来自 json-rules-engine。本文件只加载已发布的规则并返回通过、警告或阻断。
import { compareFen, parseFen, type Finding } from '@frs/domain';

type EngineEvent = { params?: { level?: string; message?: string } };

type EngineLike = {
  addOperator: (name: string, fn: (fact: unknown, value: unknown) => boolean) => void;
  addRule: (rule: object) => void;
  run: (facts: Record<string, unknown>) => Promise<{ events: EngineEvent[] }>;
};

const LEVELS = new Set(['pass', 'warn', 'block']);

export function defaultPolicyRules(): object[] {
  return [
    rule('amountFen', 'fenGreaterThan', '500000', 'block', '单笔超过 5000.00 元，强控不能提交'),
    rule('amountFen', 'fenGreaterThan', '100000', 'warn', '单笔超过 1000.00 元，弱控已记录'),
    {
      conditions: { all: [{ fact: 'crossYear', operator: 'equal', value: true }] },
      event: { type: 'timeliness', params: { level: 'warn', message: '发票跨年，提交时留下警告' } },
    },
    {
      conditions: { all: [{ fact: 'invoiceAgeDays', operator: 'greaterThanInclusive', value: 180 }] },
      event: { type: 'timeliness', params: { level: 'block', message: '发票超过 180 天，不能提交' } },
    },
  ];
}

function rule(fact: string, operator: string, value: string, level: string, message: string): object {
  return {
    conditions: { all: [{ fact, operator, value }] },
    event: { type: 'standard', params: { level, message } },
  };
}

export async function evaluatePolicyRules(rules: readonly object[], facts: Record<string, unknown>): Promise<Finding[]> {
  const loaded = (await import('json-rules-engine')) as unknown as {
    Engine?: new (rules?: object[]) => EngineLike;
    default?: { Engine?: new (rules?: object[]) => EngineLike };
  };
  const Engine = loaded.Engine ?? loaded.default?.Engine;
  if (!Engine) {
    throw new Error('规则引擎没有加载成功');
  }
  const engine = new Engine([]);
  engine.addOperator('fenGreaterThan', (fact, value) => compareFen(parseFen(String(fact)), parseFen(String(value))) > 0);
  for (const item of rules) {
    engine.addRule(item);
  }
  const result = await engine.run(facts);
  return result.events
    .map((event) => {
      const level = event.params?.level ?? '';
      const message = event.params?.message ?? '';
      if (!LEVELS.has(level) || !message) {
        return null;
      }
      return { level: level as Finding['level'], code: 'POLICY', message };
    })
    .filter((item): item is Finding => item !== null);
}
